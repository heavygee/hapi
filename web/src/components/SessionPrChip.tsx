import type { ExternalRef, GithubPrExternalRef } from '@/types/api'
import { getPrimaryGithubPrRef } from '@hapi/protocol'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export type SessionPrChipProps = {
    refs: readonly ExternalRef[] | null | undefined
    className?: string
}

export function formatGithubPrChipLabel(ref: GithubPrExternalRef): string {
    return `#${ref.number}`
}

/**
 * Clickable primary GitHub PR chip for session list rows.
 * Identity comes from structured `externalRefs` only — never from title text.
 */
export function SessionPrChip(props: SessionPrChipProps) {
    const { t } = useTranslation()
    const primary = getPrimaryGithubPrRef(props.refs)
    if (!primary) return null

    return (
        <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="session-pr-chip"
            title={`${primary.repo}#${primary.number}`}
            aria-label={t('session.item.prChip', { number: primary.number })}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
                'inline-flex shrink-0 items-center rounded-md border border-[var(--app-border)]',
                'bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                'text-[var(--app-link)] hover:opacity-90 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                props.className
            )}
        >
            {formatGithubPrChipLabel(primary)}
        </a>
    )
}
