import * as _ from 'lodash';

import { observable, action, configure, flow, computed, runInAction } from 'mobx';
import { getLocal, Mockttp, CompletedRequest, CompletedResponse } from 'mockttp';

import { HttpExchange } from '../types';
import { parseSource } from './sources';
import { getInterceptors, activateInterceptor, getConfig, announceServerReady } from './htk-client';
import { ExchangeCategory, getExchangeCategory } from '../exchange-colors';

import * as amIUsingHtml from '../amiusing.html';
import { getHTKContentType } from '../content-types';
import { Interceptor, getInterceptOptions } from './interceptors';
import { delay } from '../util';
import { getMatchingAPI } from './openapi';

configure({ enforceActions: 'observed' });

// All later components assume the store is fully activated - that means
// all undefined/nullable fields have been set.
export type ActivatedStore = { [P in keyof InterceptionStore]: NonNullable<InterceptionStore[P]> };

// Start the server, with slowly decreasing retry frequency. Total time to failure about 10s.
// Sum calculation: (initialDelayMs * (1 - delayRatio ^ maxRetries))/(1 - delayRatio)
function startServer(server: Mockttp, retries = 10, delayMs = 250): Promise<void> {
    return server.start().catch((e) => {
        if (retries > 0) {
            return delay(delayMs).then(() => startServer(server, retries - 1, delayMs * 1.3));
        } else {
            throw e;
        }
    });
}

export class InterceptionStore {

    @observable.ref
    private server: Mockttp;

    @observable
    certPath: string | undefined;

    @computed get serverPort() {
        if (this.server) {
            return this.server.port;
        } else {
            return undefined;
        }
    }

    // TODO: Combine into a batchedEvent queue of callbacks
    private requestQueue: CompletedRequest[] = [];
    private responseQueue: CompletedResponse[] = [];
    private abortedQueue: CompletedRequest[] = [];

    readonly exchanges = observable.array<HttpExchange>([], { deep: false });

    @computed get activeSources() {
        return _(this.exchanges)
            .map(e => e.request.headers['user-agent'])
            .uniq()
            .map(parseSource)
            .value();
    }

    @observable interceptors: _.Dictionary<Interceptor>;

    constructor() {
        this.server = getLocal({
            cors: false,
            standaloneServerUrl: 'http://127.0.0.1:45456'
        });
        this.interceptors = getInterceptOptions([]);
    }

    startServer = flow(function* (this: InterceptionStore) {
        yield startServer(this.server);
        announceServerReady();

        yield Promise.all([
            this.server.get(/^https?:\/\/amiusing\.httptoolkit\.tech$/).always().thenReply(
                200, amIUsingHtml, { 'content-type': 'text/html' }
            ).then(() =>
                this.server.anyRequest().always().thenPassThrough({
                    ignoreHostCertificateErrors: ['localhost']
                })
            ),
            this.refreshInterceptors(),
            getConfig().then((config) => {
                this.certPath = config.certificatePath
            })
        ]);

        setInterval(() => this.refreshInterceptors(), 10000);

        console.log(`Server started on port ${this.server.port}`);

        this.server.on('request', (req) => {
            if (this.requestQueue.length === 0 && this.responseQueue.length === 0) {
                requestAnimationFrame(this.flushQueuedUpdates);
            }

            this.requestQueue.push(req);
        });
        this.server.on('response', (res) => {
            if (this.requestQueue.length === 0 && this.responseQueue.length === 0) {
                requestAnimationFrame(this.flushQueuedUpdates);
            }

            this.responseQueue.push(res);
        });
        this.server.on('abort', (req) => {
            if (this.requestQueue.length === 0 && this.responseQueue.length === 0) {
                requestAnimationFrame(this.flushQueuedUpdates);
            }

            this.abortedQueue.push(req);
        });

        window.addEventListener('beforeunload', () => {
            this.server.stop().catch(() => { });
        });
    });

    @action.bound
    private flushQueuedUpdates() {
        // We batch request updates until here. This runs in a mobx transaction, and
        // on request animation frame, so batches get larger and cheaper if
        // the frame rate starts to drop.

        this.requestQueue.forEach((req) => this.addRequest(req));
        this.requestQueue = [];

        this.responseQueue.forEach((res) => this.setResponse(res));
        this.responseQueue = [];

        this.abortedQueue.forEach((req) => this.markRequestAborted(req));
        this.abortedQueue = [];
    }

    async refreshInterceptors() {
        const serverInterceptors = await getInterceptors(this.server.port);

        runInAction(() => {
            this.interceptors = getInterceptOptions(serverInterceptors);
        });
    }

    @action
    private addRequest(request: CompletedRequest) {
        const parsedUrl = new URL(request.url, `${request.protocol}://${request.hostname}`);

        const minimalExchange = {
            id: request.id,
            request: Object.assign(request, {
                parsedUrl,
                source: parseSource(request.headers['user-agent']),
                contentType: getHTKContentType(request.headers['content-type'])
            }),
            searchIndex:
                [`${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`]
                    .concat(..._.map(request.headers, (value, key) => `${key}: ${value}`))
                    .concat(request.method)
                    .join('\n')
                    .toLowerCase(),
            response: undefined
        };

        const completeExchange = Object.assign(minimalExchange, {
            category: <ExchangeCategory>getExchangeCategory(minimalExchange)
        });

        // Start loading any relevant Open API specs for this request
        getMatchingAPI(completeExchange);

        this.exchanges.push(observable.object(completeExchange, {}, { deep: false }));
    }

    @action
    private markRequestAborted(request: CompletedRequest) {
        const exchange = _.find(this.exchanges, (exchange) => exchange.request.id === request.id)!;

        // Shouldn't happen in general, but possible in some very rare cases
        if (!exchange) return;

        exchange.response = 'aborted';
        exchange.searchIndex += ('\naborted');
    }

    @action
    private setResponse(response: CompletedResponse) {
        const exchange = _.find(this.exchanges, (exchange) => exchange.request.id === response.id)!;

        // Shouldn't happen in general, but possible in some very rare cases
        if (!exchange) return;

        exchange.response = Object.assign(response, {
            contentType: getHTKContentType(response.headers['content-type'])
        });
        exchange.category = getExchangeCategory(exchange);

        exchange.searchIndex += '\n' + [
            response.statusCode.toString(),
            response.statusMessage.toString(),
            ..._.map(response.headers, (value, key) => `${key}: ${value}`)
        ].join('\n').toLowerCase();
    }

    @action.bound
    clearExchanges() {
        this.exchanges.clear();
    }

    async activateInterceptor(interceptorId: string) {
        await activateInterceptor(interceptorId, this.server.port).catch(console.warn);
        await this.refreshInterceptors();
    }

}