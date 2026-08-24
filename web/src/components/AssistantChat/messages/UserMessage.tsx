import { MessagePrimitive, useAuiState, type TextMessagePart } from '@assistant-ui/react'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { UserBubbleContent, getUserBubbleClassName, shouldShowMessageStatus } from '@/components/AssistantChat/messages/user-bubble'
import { PeerSenderChip } from '@/components/AssistantChat/messages/PeerSenderChip'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { MessageActions } from '@/components/AssistantChat/messages/MessageActions'
import {
    parseClaimedPeerFromText,
    stripClaimedPeerHeaderForDisplay,
} from '@/chat/peerDelivery'
import { useTranslation } from '@/lib/use-translation'

type AuiMessageSnapshot = {
    message: {
        role: string
        metadata: { custom?: Partial<HappyChatMessageMetadata> }
    }
}

/** Exported for Object.is stability tests (useSyncExternalStore / useAuiState). */
export function selectIsPeerDelivery(s: AuiMessageSnapshot): boolean {
    if (s.message.role !== 'user') return false
    return s.message.metadata.custom?.sentFrom === 'peer'
}

export function selectPeerSourceId(s: AuiMessageSnapshot): string | null {
    if (s.message.role !== 'user') return null
    if (s.message.metadata.custom?.sentFrom !== 'peer') return null
    const id = s.message.metadata.custom?.peer?.sourceSessionId
    return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function selectPeerSourceName(s: AuiMessageSnapshot): string | null {
    if (s.message.role !== 'user') return null
    if (s.message.metadata.custom?.sentFrom !== 'peer') return null
    const name = s.message.metadata.custom?.peer?.sourceName
    return typeof name === 'string' && name.trim() ? name.trim() : null
}

export function HappyUserMessage() {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const role = useAuiState((s) => s.message.role)
    const messageId = useAuiState((s) => s.message.id)
    const elementId = getConversationMessageAnchorId(messageId)
    const text = useAuiState((s) => {
        if (s.message.role !== 'user') return ''
        return s.message.content.find((part): part is TextMessagePart => part.type === 'text')?.text ?? ''
    })
    const status = useAuiState((s) => {
        if (s.message.role !== 'user') return undefined
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAuiState((s) => {
        if (s.message.role !== 'user') return null
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAuiState((s) => {
        if (s.message.role !== 'user') return undefined
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    // Primitives only — object literals from useAuiState break useSyncExternalStore
    // Object.is caching (assistant-ui store contract; Sol pass 2b B2).
    const isPeerDelivery = useAuiState((s) => selectIsPeerDelivery(s))
    const peerSourceId = useAuiState((s) => selectPeerSourceId(s))
    const peerSourceName = useAuiState((s) => selectPeerSourceName(s))
    const isCliOutput = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const steered = useAuiState(({ message }) => (
        message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
    )?.steered === true)
    const cliText = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return s.message.content.find((part): part is TextMessagePart => part.type === 'text')?.text ?? ''
    })
    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const showStatus = shouldShowMessageStatus(status)

    const history = ctx.metadata?.capabilities?.conversationHistory
    const hasNativePoint = typeof localId === 'string'
        && localId.length > 0
        && ctx.metadata?.conversationHistoryPoints?.[localId] === true
    const isLatestBoundary = ctx.isLatestCompletedBoundary?.(messageId) === true
    const showCurrentFork = Boolean(
        history?.forkCurrent
        && isLatestBoundary
        && !ctx.disabled
        && ctx.onForkConversation
    )
    const showHistoricalFork = Boolean(
        history?.forkAtMessage
        && hasNativePoint
        && !isLatestBoundary
        && !ctx.disabled
        && ctx.onForkConversation
    )
    const showFork = showCurrentFork || showHistoricalFork
    const showRewind = Boolean(
        history?.rewindToMessage
        && hasNativePoint
        && !ctx.disabled
        && ctx.onRewindConversation
    )

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root
                id={elementId}
                data-hapi-message-role="user"
                className="happy-message scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <div className="ml-auto w-full max-w-[92%]">
                    <CliOutputBlock text={cliText} />
                    <MessageActions align="end" copyText={cliText} messageElementId={elementId} />
                </div>
            </MessagePrimitive.Root>
        )
    }

    const hasText = text.length > 0
    const hasAttachments = attachments && attachments.length > 0
    const claimedPeer = isPeerDelivery && !peerSourceId
        ? parseClaimedPeerFromText(text)
        : null
    // Only strip client From:/Name: stamps on unverified rows. Trusted
    // deliveries keep hub-stamped agent provenance lines in the bubble.
    const displayText = isPeerDelivery && !peerSourceId
        ? stripClaimedPeerHeaderForDisplay(text)
        : text
    const displayHasText = displayText.length > 0

    return (
        <MessagePrimitive.Root
            id={elementId}
            data-hapi-message-role="user"
            className="happy-message flex flex-col items-end scroll-mt-4"
        >
            <div className={getUserBubbleClassName(status)}>
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        {isPeerDelivery ? (
                            <div className="mb-1.5">
                                <PeerSenderChip
                                    sourceSessionId={peerSourceId}
                                    sourceName={peerSourceName}
                                    claimedSessionId={claimedPeer?.sessionId}
                                    claimedName={claimedPeer?.name}
                                />
                            </div>
                        ) : null}
                        {displayHasText ? <UserBubbleContent text={displayText} /> : null}
                        {hasAttachments ? <MessageAttachments attachments={attachments} /> : null}
                    </div>
                    {showStatus && (
                        <div className="happy-message-actions-first-line flex shrink-0 items-center gap-1">
                            {showStatus ? <MessageStatusIndicator status={status} onRetry={onRetry} /> : null}
                        </div>
                    )}
                </div>
                {steered ? (
                    <span
                        title={t('queuedMessages.steeredBadgeTitle')}
                        className="mt-1 inline-flex items-center gap-0.5 text-[10px] leading-none text-[var(--app-hint)]"
                    >
                        {t('queuedMessages.steeredBadge')}
                    </span>
                ) : null}
            </div>
            <MessageActions
                align="end"
                copyText={hasText ? text : undefined}
                messageElementId={elementId}
                showFork={showFork}
                showRewind={showRewind}
                historyActionPending={ctx.historyActionPending}
                onFork={showCurrentFork
                    ? () => ctx.onForkConversation!()
                    : showHistoricalFork && localId
                        ? () => ctx.onForkConversation!(localId)
                        : undefined}
                onRewind={showRewind && localId
                    ? () => ctx.onRewindConversation!(localId)
                    : undefined}
            />
        </MessagePrimitive.Root>
    )
}
