import { useNavigate } from '@tanstack/react-router'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { useSessions } from '@/hooks/queries/useSessions'
import {
    SESSION_MENTION_CHIP_CLASSNAME,
    formatSessionMentionChipLabel,
} from '@/lib/sessionMentionChip'
import { formatSessionMentionTooltip } from '@/lib/sessionReference'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type PeerSenderChipProps = {
    /** Hub-trusted source session id (capability path). */
    sourceSessionId?: string | null
    sourceName?: string | null
    /**
     * Client-stamped claim from message text when hub did not attribute.
     * Display-only — never treat as verified provenance.
     */
    claimedSessionId?: string | null
    claimedName?: string | null
}

/**
 * Peer-delivery sender identity — same `@title` chip chrome as rich-composer
 * session mentions so "who sent this" matches @ referencing (#1203).
 *
 * Verified deliveries (hub `sourceSessionId`) render a navigable chip.
 * Unverified deliveries reuse the same chrome with a ⚠ mark + tooltip.
 */
export function PeerSenderChip({
    sourceSessionId,
    sourceName,
    claimedSessionId,
    claimedName,
}: PeerSenderChipProps) {
    const navigate = useNavigate()
    const { t } = useTranslation()
    const chatCtx = useOptionalHappyChatContext()
    const { sessions } = useSessions(chatCtx?.api ?? null)

    const verifiedId = sourceSessionId?.trim() || ''
    const claimedId = claimedSessionId?.trim() || ''
    const verified = Boolean(verifiedId)
    const id = verifiedId || claimedId
    const metaName = (verified ? sourceName : claimedName)?.trim() || ''
    const listed = id ? sessions.find((session) => session.id === id) : undefined
    const title = metaName || listed?.metadata?.name?.trim() || ''

    if (!id) {
        const tip = t('message.peerUnverifiedTooltip')
        return (
            <span
                className={cn(SESSION_MENTION_CHIP_CLASSNAME, 'text-[var(--app-hint)]')}
                data-hapi-peer-delivery="true"
                data-hapi-peer-unknown="true"
                data-hapi-peer-unverified="true"
                title={tip}
                aria-label={tip}
            >
                <span>{t('message.peerUnknownChip')}</span>
                <span className="ml-1 shrink-0" aria-hidden="true">⚠</span>
            </span>
        )
    }

    const label = formatSessionMentionChipLabel(title, id)
    const identityTip = formatSessionMentionTooltip(null, title, id)
    const unverifiedTip = t('message.peerUnverifiedTooltip')
    const tipLines = verified
        ? identityTip.lines
        : [...identityTip.lines, '', unverifiedTip]
    const tipText = tipLines.join('\n')
    const ariaLabel = verified
        ? identityTip.ariaLabel
        : `${identityTip.ariaLabel}. ${unverifiedTip}`

    // When the sessions query has loaded rows and this id is missing, do not
    // offer a dead navigation. Empty/loading cache keeps the link (optimistic).
    const sourceStillListed = sessions.length === 0 || Boolean(listed)

    const chipBody = (
        <>
            <span className="truncate">{label}</span>
            {!verified ? (
                <span className="ml-1 shrink-0" aria-hidden="true">⚠</span>
            ) : null}
        </>
    )

    if (!sourceStillListed) {
        return (
            <span
                className={cn(SESSION_MENTION_CHIP_CLASSNAME, 'text-[var(--app-hint)]')}
                data-hapi-peer-delivery="true"
                data-session-id={id}
                data-session-title={title || undefined}
                data-hapi-peer-source-gone="true"
                data-hapi-peer-unverified={verified ? undefined : 'true'}
                title={tipText}
                aria-label={ariaLabel}
            >
                {chipBody}
            </span>
        )
    }

    return (
        <button
            type="button"
            className={SESSION_MENTION_CHIP_CLASSNAME}
            data-hapi-peer-delivery="true"
            data-session-id={id}
            data-session-title={title || undefined}
            data-hapi-peer-unverified={verified ? undefined : 'true'}
            aria-label={ariaLabel}
            title={tipText}
            onClick={() => {
                void navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: id },
                })
            }}
        >
            {chipBody}
        </button>
    )
}
