import { useId } from 'react'
import type { ExternalRef, GithubPrExternalRef, GithubPrStatus } from '@/types/api'
import { getPrimaryGithubPrRef, githubPrStatusEmoji } from '@hapi/protocol'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relativeTime'
import { useTranslation } from '@/lib/use-translation'
import { HoverTooltip } from '@/components/HoverTooltip'

type RelativeTimeTFunc = (key: string, params?: Record<string, string | number>) => string

/** Chip cache older than this is treated as honesty-❓ (muted tone). */
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
 * Never live-queries GitHub — when `statusCheckedAt` is older than 2h, mute to `unknown` / ❓.
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

/**
 * Compact chip glyph: status emoji only (or `PR` when uncached).
 * Full `repo#N` + status copy lives in the tooltip / action-menu header.
 */
export function formatGithubPrChipLabel(
    ref: GithubPrExternalRef,
    nowMs?: number
): string {
    const { status } = resolveGithubPrChipDisplay(ref, nowMs ?? Date.now())
    const emoji = githubPrStatusEmoji(status)
    if (emoji) return emoji
    return 'PR'
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
 * Glyph + status body shared by chip tooltip and session action menus.
 */
export function formatGithubPrChipDetailParts(
    ref: GithubPrExternalRef,
    display: GithubPrChipDisplay,
    t: RelativeTimeTFunc,
    nowMs?: number
): { glyph: string; detail: string } {
    const glyph = formatGithubPrChipLabel(ref, nowMs)
    const identity = `${ref.repo}#${ref.number}`
    if (!ref.status && !display.status) return { glyph, detail: identity }
    const relative = typeof ref.statusCheckedAt === 'number'
        ? formatRelativeTime(ref.statusCheckedAt, t)
        : null
    const checked = relative ? ` · checked ${relative}` : ''
    const staleNote = display.stale ? ' · stale (>2h)' : ''
    const shown = display.status ?? ref.status
    const action = !display.stale && ref.statusAction ? ` — ${ref.statusAction}` : ''
    return { glyph, detail: `${identity} · ${shown}${checked}${staleNote}${action}` }
}

/** Same string as chip mouseover tooltip: `glyph owner/repo#N · status…`. */
export function formatGithubPrChipTitle(
    ref: GithubPrExternalRef,
    display: GithubPrChipDisplay,
    t: RelativeTimeTFunc,
    nowMs?: number
): string {
    const { glyph, detail } = formatGithubPrChipDetailParts(ref, display, t, nowMs)
    return `${glyph} ${detail}`
}

/**
 * Compact primary GitHub PR chip for session list rows.
 * Glyph stays compact; mouseover/focus on *this chip* reveals the same
 * detail string as the session action menu (emoji + status explanation).
 */
export function SessionPrChip(props: SessionPrChipProps) {
    const { t } = useTranslation()
    const tooltipId = useId()

    const primary = getPrimaryGithubPrRef(props.refs)
    if (!primary) return null

    const nowMs = props.nowMs ?? Date.now()
    const display = resolveGithubPrChipDisplay(primary, nowMs)
    const glyph = formatGithubPrChipLabel(primary, nowMs)
    const detail = formatGithubPrChipTitle(primary, display, t, nowMs)

    return (
        <HoverTooltip
            id={tooltipId}
            side="bottom"
            align="end"
            hoverGroup="help"
            className={cn('relative z-20 shrink-0 overflow-visible', props.className)}
            tooltipClassName="max-w-[18rem] whitespace-normal"
            target={(
                <a
                    href={primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="session-pr-chip"
                    data-pr-status={display.status ?? 'unset'}
                    data-pr-stale={display.stale ? '1' : '0'}
                    aria-describedby={tooltipId}
                    title={detail}
                    aria-label={
                        display.status
                            ? t('session.item.prChipWithStatus', {
                                number: primary.number,
                                status: display.status
                            })
                            : t('session.item.prChip', { number: primary.number })
                    }
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    className={cn(
                        'inline-flex min-w-[1.35rem] shrink-0 items-center justify-center rounded-md border',
                        'bg-[var(--app-subtle-bg)] px-1 py-0.5 text-[12px] font-medium leading-none',
                        'hover:opacity-90 focus-visible:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                        statusToneClass(display.status)
                    )}
                >
                    {glyph}
                </a>
            )}
        >
            <span className="block font-medium">{detail}</span>
        </HoverTooltip>
    )
}
