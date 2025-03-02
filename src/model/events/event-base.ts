import { observable, computed } from 'mobx';

import {
    FailedTlsConnection,
    TlsTunnel,
    ViewableHttpExchange,
    RTCConnection,
    RTCDataChannel,
    RTCMediaTrack,
    WebSocketStream
} from '../../types';

import { getEventCategory } from './categorization';

export abstract class HTKEventBase {

    abstract get id(): string;

    // These can be overriden by subclasses to allow easy type narrowing:
    isHttp(): this is ViewableHttpExchange { return false; }
    isWebSocket(): this is WebSocketStream { return false; }

    isTlsFailure(): this is FailedTlsConnection { return false; }
    isTlsTunnel(): this is TlsTunnel { return false; }

    isRTCConnection(): this is RTCConnection { return false; }
    isRTCDataChannel(): this is RTCDataChannel { return false; }
    isRTCMediaTrack(): this is RTCMediaTrack { return false; }

    @computed
    public get category() {
        return getEventCategory(this);
    }

    @observable
    private _searchIndex: string = '';
    public get searchIndex(): string { return this._searchIndex; }
    public set searchIndex(value: string) { this._searchIndex = value; }

    @observable
    private _pinned: boolean = false;
    public get pinned(): boolean { return this._pinned; }
    public set pinned(value: boolean) { this._pinned = value; }

    // Logic elsewhere can put values into these caches to cache calculations
    // about this event weakly, so they GC with the event.
    // Keyed by symbols only, so we know we never have conflicts.
    public cache = observable.map(new Map<symbol, unknown>(), { deep: false });

}