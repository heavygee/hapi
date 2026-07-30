import type { ExternalRef, GithubPrExternalRef, GithubPrStatus } from '@/types/api'
import { getPrimaryGithubPrRef, githubPrStatusEmoji } from '@hapi/protocol'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relativeTime'
import { useTranslation } from '@/lib/use-translation'

type TFunc = (key: string, params?: Record<string, string | number>) => string

/** Chip cache older than this is treated as honesty-`?` (muted tone). */
export const GITHUB_PR_CHIP_STALE_MS = 2 * 60 * 60 * 1000

export type SessionPrChipProps = {
    refs: readonly ExternalRef[] | null | undefined
    className?: string
    /** Injectable clock for tests (ms since epoch). */
    nowMs?: number
}

export type GithubPrChipDisplay = {
    /** Status used for emoji + tone (unknown when cache is stale). */
    status: GithubPrStatus | undefined
    stale: boolean
}

/**
 * Resolve display status from cached `externalRefs` fields.
 * Never live-queries GitHub — when `statusCheckedAt` is older than 2h, mute to `unknown` / `?`.
 */
export function resolveGithubPrChipDisplay(
    ref: GithubPrExternalRef,
    nowMs: number = Date.now(),
    staleMs: number = GITHUB_PR_CHIP_STALE_MS
): GithubPrChipDisplay {
    if (!ref.status) return { status: undefined, stale: false }
    if (
        typeof ref.statusCheckedAt === 'number'
        && nowMs - ref.statusCheckedAt > staleMs
    ) {
        return { status: 'unknown', stale: true }
    }
    return { status: ref.status, stale: false }
}

export function formatGithubPrChipLabel(
    ref: GithubPrExternalRef,
    nowMs?: number
): string {
    const { status } = resolveGithubPrChipDisplay(ref, nowMs ?? Date.now())
    const emoji = githubPrStatusEmoji(status)
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

/**
 * Native `title` tooltip body for the PR chip.
 *
 * Exception to the usual "ago in UI + absolute in tooltip" rule: this string
 * *is* the tooltip, so nest absolute datetime nowhere - use relative "ago".
 */
export function formatGithubPrChipTitle(
    ref: GithubPrExternalRef,
    display: GithubPrChipDisplay,
    t: TFunc
): string {
    const identity = `${ref.repo}#${ref.number}`
    if (!ref.status && !display.status) return identity
    const relative = typeof ref.statusCheckedAt === 'number'
        ? formatRelativeTime(ref.statusCheckedAt, t)
        : null
    const checked = relative ? ` · checked ${relative}` : ''
    const staleNote = display.stale ? ' · stale (>2h)' : ''
    const shown = display.status ?? ref.status
    const action = !display.stale && ref.statusAction ? ` — ${ref.statusAction}` : ''
    return `${identity} · ${shown}${checked}${staleNote}${action}`
}

/**
 * Clickable primary GitHub PR chip for session list rows.
 * Identity + optional cached status from `externalRefs` (ADR D8) — never title text.
 * Stale cache (>2h since statusCheckedAt) mutes tone and shows `?`.
 */
export function SessionPrChip(props: SessionPrChipProps) {
    const { t } = useTranslation()
    const primary = getPrimaryGithubPrRef(props.refs)
    if (!primary) return null

    const nowMs = props.nowMs ?? Date.now()
    const display = resolveGithubPrChipDisplay(primary, nowMs)

    return (
        <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="session-pr-chip"
            data-pr-status={display.status ?? 'unset'}
            data-pr-stale={display.stale ? '1' : '0'}
            title={formatGithubPrChipTitle(primary, display, t)}
            aria-label={
                display.status
                    ? t('session.item.prChipWithStatus', {
                        number: primary.number,
                        status: display.status
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
                statusToneClass(display.status),
                props.className
            )}
        >
            {formatGithubPrChipLabel(primary, nowMs)}
        </a>
    )
}
