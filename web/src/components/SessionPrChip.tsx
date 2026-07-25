import type { ExternalRef, GithubPrExternalRef, GithubPrStatus } from '@/types/api'
import { getPrimaryGithubPrRef, githubPrStatusEmoji } from '@hapi/protocol'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export type SessionPrChipProps = {
    refs: readonly ExternalRef[] | null | undefined
    className?: string
}

export function formatGithubPrChipLabel(ref: GithubPrExternalRef): string {
    const emoji = githubPrStatusEmoji(ref.status)
    return emoji ? `${emoji}#${ref.number}` : `#${ref.number}`
}

function statusToneClass(status: GithubPrStatus | undefined): string {
    switch (status) {
        case 'clean':
            return 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
        case 'needs_work':
            return 'border-amber-500/50 text-amber-800 dark:text-amber-200'
        case 'pending':
            return 'border-sky-500/40 text-sky-700 dark:text-sky-300'
        case 'merged':
            return 'border-violet-500/40 text-violet-700 dark:text-violet-300'
        case 'pre_pr':
            return 'border-[var(--app-border)] text-[var(--app-muted-fg)]'
        case 'unknown':
            return 'border-dashed border-[var(--app-border)] text-[var(--app-muted-fg)]'
        default:
            return 'border-[var(--app-border)] text-[var(--app-link)]'
    }
}

function chipTitle(ref: GithubPrExternalRef): string {
    const identity = `${ref.repo}#${ref.number}`
    if (!ref.status) return identity
    const checked = ref.statusCheckedAt
        ? ` · checked ${new Date(ref.statusCheckedAt).toISOString()}`
        : ''
    const action = ref.statusAction ? ` — ${ref.statusAction}` : ''
    return `${identity} · ${ref.status}${checked}${action}`
}

/**
 * Clickable primary GitHub PR chip for session list rows.
 * Identity + optional cached status from `externalRefs` (ADR D8) — never title text.
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
            data-pr-status={primary.status ?? 'unset'}
            title={chipTitle(primary)}
            aria-label={
                primary.status
                    ? t('session.item.prChipWithStatus', {
                        number: primary.number,
                        status: primary.status
                    })
                    : t('session.item.prChip', { number: primary.number })
            }
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
                'inline-flex shrink-0 items-center rounded-md border',
                'bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                'hover:opacity-90 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                statusToneClass(primary.status),
                props.className
            )}
        >
            {formatGithubPrChipLabel(primary)}
        </a>
    )
}
