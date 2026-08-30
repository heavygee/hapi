import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CheckIcon, CopyIcon, InfoIcon, PinIcon } from '@/components/icons'
import { useOptionalHappyChatContext, useHappyChatContext } from '@/components/AssistantChat/context'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { hubMessageIdFromThreadMessageId, useSessionPins } from '@/hooks/useSessionPins'
import { useTranslation } from '@/lib/use-translation'
import { MessageMetadata, buildMessageMetadataLabels, type MessageMetadataProps } from './MessageMetadata'
import { MessageTimestamp } from './MessageTimestamp'
import { cn } from '@/lib/utils'

type MessageActionsProps = {
    align: 'start' | 'end'
    copyText?: string
    /** assistant-ui thread message id (`agent-text:<hubId>:0`, …). */
    messageId?: string
    metadata?: Omit<MessageMetadataProps, 'className'>
}

export function MessageActions({ align, copyText, messageId, metadata }: MessageActionsProps) {
    const { copied, copy } = useCopyToClipboard()
    const { t } = useTranslation()
    const chat = useOptionalHappyChatContext()

    const canCopy = Boolean(copyText)
    const hasMetadata = metadata ? buildMessageMetadataLabels(metadata).length > 0 : false
    const showPin = Boolean(chat && messageId)

    return (
        <div
            className={cn(
                'happy-message-actions mt-1 flex h-5 items-center gap-1',
                align === 'end' ? 'justify-end' : 'justify-start',
                !canCopy && !showPin && 'happy-message-actions-desktop-only-row'
            )}
        >
            {align === 'end' ? <DesktopTimestamp /> : null}
            {canCopy ? (
                <button
                    type="button"
                    title={copied ? t('message.copied') : t('message.copy')}
                    aria-label={copied ? t('message.copied') : t('message.copy')}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    onClick={() => copy(copyText!)}
                >
                    {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </button>
            ) : null}
            {showPin && messageId ? (
                <MessagePinButton messageId={messageId} copyText={copyText} />
            ) : null}
            {hasMetadata && metadata ? <MessageInfoPopover metadata={metadata} /> : null}
            {align === 'start' ? <DesktopTimestamp /> : null}
        </div>
    )
}

function MessagePinButton(props: { messageId: string; copyText?: string }) {
    const { t } = useTranslation()
    const chat = useHappyChatContext()
    const pins = useSessionPins(chat.api, chat.sessionId)
    const [pinBusy, setPinBusy] = useState(false)
    const [pinError, setPinError] = useState<string | null>(null)
    const hubMessageId = hubMessageIdFromThreadMessageId(props.messageId)
    if (!hubMessageId) return null

    const pinned = pins.isPinned(hubMessageId)

    const handleTogglePin = async () => {
        if (pinBusy) return
        setPinBusy(true)
        setPinError(null)
        try {
            if (pinned) {
                await pins.unpin(hubMessageId)
            } else {
                await pins.pin({
                    messageId: hubMessageId,
                    summary: (props.copyText?.trim() || 'Pinned message').slice(0, 500),
                    targetMessageId: props.messageId
                })
            }
        } catch (err) {
            setPinError(err instanceof Error ? err.message : String(err))
        } finally {
            setPinBusy(false)
        }
    }

    return (
        <button
            type="button"
            title={pinError ?? (pinned ? t('message.unpin') : t('message.pin'))}
            aria-label={pinned ? t('message.unpin') : t('message.pin')}
            aria-pressed={pinned}
            disabled={pinBusy}
            className={cn(
                'flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--app-subtle-bg)]',
                pinned
                    ? 'text-[var(--app-link)]'
                    : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                pinBusy && 'opacity-50'
            )}
            onClick={() => {
                void handleTogglePin()
            }}
        >
            <PinIcon className="h-3.5 w-3.5" />
        </button>
    )
}

function DesktopTimestamp() {
    return (
        <span className="happy-message-actions-desktop-only ml-1 items-center">
            <MessageTimestamp className="text-[10px] leading-none text-[var(--app-hint)]" />
        </span>
    )
}

function MessageInfoPopover({ metadata }: { metadata: Omit<MessageMetadataProps, 'className'> }) {
    const { t } = useTranslation()
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    title={t('message.info')}
                    aria-label={t('message.info')}
                    className="happy-message-actions-desktop-only h-5 w-5 items-center justify-center rounded text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                >
                    <InfoIcon className="h-3.5 w-3.5" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 shadow-lg"
                >
                    <MessageMetadata {...metadata} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
