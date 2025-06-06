import * as React from 'react';
import { action } from 'mobx';
import { observer, inject } from 'mobx-react';

import { CollectedEvent, ViewableEvent, HttpExchangeView } from '../../../types';
import { styled, css } from '../../../styles';
import { Ctrl } from '../../../util/ui';

import { RulesStore } from '../../../model/rules/rules-store';
import { AccountStore } from '../../../model/account/account-store';

import { HEADER_FOOTER_HEIGHT } from '../view-event-list-footer';
import { ProPill } from '../../account/pro-placeholders';
import { IconButton } from '../../common/icon-button';
import { UnstyledButton } from '../../common/inputs';

const ButtonsContainer = styled.div`
    height: ${HEADER_FOOTER_HEIGHT}px;
    flex-shrink: 0;
    width: 100%;
    padding-left: 5px;
    box-sizing: border-box;

    background-color: ${p => p.theme.mainBackground};

    display: flex;

    align-items: center;
    justify-content: center;

    z-index: 1;
    box-shadow: 0 -10px 30px -5px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
`;

const ScrollToButton = observer((p: {
    onClick: () => void
}) => <IconButton
    icon={['fas', 'eye']}
    title={'Scroll the list to show this exchange'}
    onClick={p.onClick}
/>);

const PinButton = styled(observer((p: {
    className?: string,
    pinned: boolean,
    onClick: () => void
}) => <IconButton
    className={p.className}
    icon={['fas', 'thumbtack']}
    title={
        (
            p.pinned
            ? "Unpin this exchange so it can be deleted"
            : "Pin this exchange, so it can't be deleted"
        ) + ` (${Ctrl}+P)`
    }
    onClick={p.onClick}
/>))`
    transition: transform 0.1s;

    ${p => !p.pinned && css`
        transform: rotate(45deg);
    `}
`;

const DeleteButton = observer((p: {
    pinned: boolean,
    onClick: () => void
}) => <IconButton
    icon={['far', 'trash-alt']}
    title={`Delete this exchange (${Ctrl}+Delete)`}
    onClick={p.onClick}
/>);

const ModifyButton = observer((p: {
    isExchange: boolean,
    isPaidUser: boolean,
    onClick: () => void
}) => <IconButton
    icon='Pencil'
    onClick={p.onClick}
    title={
        p.isPaidUser
            ? `Create a modify rule from this exchange (${Ctrl}+m)`
            : 'With Pro: create a modify rule from this exchange'
    }
    disabled={!p.isExchange || !p.isPaidUser}
/>);

const SendButton = observer((p: {
    isExchange: boolean,
    isPaidUser: boolean,
    onClick: () => void
}) => <IconButton
    icon='PaperPlaneTilt'
    onClick={p.onClick}
    title={p.isPaidUser
        ? `Resend this request (${Ctrl}+r)`
        : 'With Pro: Resend this request'
    }
    disabled={!p.isExchange || !p.isPaidUser}
/>);

const ProSeparator = styled(inject('accountStore')((p: {
    accountStore?: AccountStore,
    className?: string
}) => <UnstyledButton
    onClick={() => p.accountStore!.getPro('http-event-footer')}
    className={p.className}
>
    <ProPill>With Pro:</ProPill>
</UnstyledButton>))`
    padding: 0;
    margin-left: 40px;
`;

export const HttpDetailsFooter = inject('rulesStore')(
    observer(
        (props: {
            rulesStore?: RulesStore,

            event: ViewableEvent,
            onDelete: (event: CollectedEvent) => void,
            onScrollToEvent: (event: CollectedEvent) => void,
            onBuildRuleFromExchange: (event: HttpExchangeView) => void,
            onPrepareToResendRequest?: (event: HttpExchangeView) => void,
            isPaidUser: boolean,
            navigate: (url: string) => void
        }) => {
            const { event } = props;
            const { pinned } = event;

            // Some actions require the collected event, not just the
            // current view.
            const collectedEvent = 'downstream' in event
                ? event.downstream
                : event;

            return <ButtonsContainer>
                <ScrollToButton
                    onClick={() => props.onScrollToEvent(collectedEvent)}
                />
                <PinButton
                    pinned={pinned}
                    onClick={action(() => {
                        event.pinned = !event.pinned;
                    })}
                />
                <DeleteButton
                    pinned={pinned}
                    onClick={() => props.onDelete(collectedEvent)}
                />

                {
                    !props.isPaidUser &&
                        <ProSeparator />
                }

                <ModifyButton
                    isExchange={event.isHttp() && !event.isWebSocket()}
                    isPaidUser={props.isPaidUser}
                    onClick={() => props.onBuildRuleFromExchange(props.event as HttpExchangeView)}
                />
                { props.onPrepareToResendRequest &&
                    <SendButton
                        isExchange={event.isHttp() && !event.isWebSocket()}
                        isPaidUser={props.isPaidUser}
                        onClick={() => props.onPrepareToResendRequest!(
                            props.event as HttpExchangeView
                        )}
                    />
                }
            </ButtonsContainer>;
        }
    )
);