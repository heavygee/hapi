import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '@/types/api'
import { isWildcardSearch, matchesSearchQuery } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { useHoldToTalk } from '@/hooks/useHoldToTalk'
import { useDictation } from '@/hooks/useDictation'
import { useVoiceInputPreferences } from '@/hooks/useVoiceInputPreferences'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionExportDialog } from '@/components/SessionExportDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { LinkPrDialog } from '@/components/LinkPrDialog'
import { SessionPrChip, formatGithubPrChipDetailParts, resolveGithubPrChipDisplay } from '@/components/SessionPrChip'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { DEFAULT_SESSION_PREVIEW_LIMIT, useSessionPreviewLimit } from '@/hooks/useSessionPreviewLimit'
import { useSessionListStatusMode } from '@/hooks/useSessionListStatusMode'
import {
    BLOCKED_ALERT_PULSE_MS,
    useBlockedAlertMode,
    type BlockedAlertMode
} from '@/hooks/useBlockedAlertMode'
import { playBlockedAlertSound } from '@/lib/blockedAlertSound'
import { useShowActiveSessionsOnly } from '@/hooks/useShowActiveSessionsOnly'
import {
    usePinInProgressSessions,
    type PinInProgressMode
} from '@/hooks/usePinInProgressSessions'
import {
    classifySessionAttention,
    getSessionBlockedState,
    sessionBlockedIsError,
    sessionIsBlocked,
    sessionIsUnread
} from '@/lib/sessionAttention'
import {
    hasAgentForegroundWork,
    hasRunningAttachedJob,
} from '@/lib/sessionInProgress'
import {
    getSessionLastSeenAt,
    getSessionLastSeenSnapshot,
    getSessionManualUnreadAt,
    markSessionUnread,
    useSessionLastSeenVersion
} from '@/lib/sessionLastSeen'
import { useSessionRowTooltipIds } from '@/components/HoverTooltip'
import { subscribeCodexImportedSessions } from '@/lib/codexImportedSessions'
import { formatReopenError } from '@/lib/reopenError'
import { resolveCursorReopenGate } from '@/lib/sessionResume'
import { getSessionTitle, hasSessionTitleSignal } from '@/lib/sessionTitle'
import { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'
import { retargetSharePendingTransfer } from '@/lib/sharePendingState'
import { getGroupDisplayName } from '@/lib/sessionProjectLabel'
import type { Machine } from '@/types/api'
import { getMachinePlatform, presentMachineHealth } from '@/lib/machineHealth'
import { MachineFilterBar, MachineFilterMenu } from '@/components/MachineFilterBar'
import { useSessionListMachineFilter } from '@/hooks/useSessionListMachineFilter'
import { useCursorChatStoreStatus } from '@/hooks/queries/useCursorChatStoreStatus'
import { useFeatures } from '@/hooks/queries/useFeatures'
import { getPrimaryGithubPrRef } from '@hapi/protocol'
import { SessionRowSummary } from '@/components/SessionRowSummary'
import { KitchenStatusChip } from '@/components/KitchenStatusChip'
import { Spinner } from '@/components/Spinner'
import { useToast } from '@/lib/toast-context'
import { transferComposerDraftThenNavigate } from '@/lib/composer-draft-transfer'

export { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'

/** Outer row chrome — selected background lives here, not on the button. */
export function sessionListItemWrapperClassName(selected: boolean): string {
    return `session-list-item flex w-full items-stretch rounded-lg transition-colors${selected ? ' bg-[var(--app-secondary-bg)]' : ''}`
}

/** Focusable row control — owns `group/session-row` for keyboard tooltip reveal. */
export function sessionListItemButtonClassName(): string {
    return 'group/session-row flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg'
}

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
    hasPinnedSession: boolean
}

const RUNNING_BUCKETS = [
    { key: 'jobs', labelKey: 'session.item.attachedJob', colorClass: 'text-[var(--app-badge-success-text)]', pulse: true },
    { key: 'working', labelKey: 'session.item.running', colorClass: 'text-[var(--app-badge-success-text)]', pulse: true },
    { key: 'pending', labelKey: 'session.item.pending', colorClass: 'text-[var(--app-badge-warning-text)]', pulse: true },
    { key: 'active', labelKey: 'session.item.active', colorClass: 'text-[var(--app-hint)]', pulse: false },
] as const

type RunningBucketKey = (typeof RUNNING_BUCKETS)[number]['key']

function hasAgentInProgressActivity(session: SessionSummary): boolean {
    if (!session.active) {
        return false
    }
    // Durable project/global pins stay in project groups / top band (#1115).
    if (session.pinned || session.globalPinned) {
        return false
    }
    return hasAgentForegroundWork(session)
        || (session.pendingRequestsCount ?? 0) > 0
}

/**
 * Sessions that float into the pinned In progress section.
 * Mode is a degree: off → jobs (outliving attachedJob) → all (jobs + agent activity).
 */
export function isPinnedInProgressSession(
    session: SessionSummary,
    mode: PinInProgressMode
): boolean {
    if (mode === 'off') {
        return false
    }
    // Durable project/global pins stay in project groups / top band (#1115).
    if (session.pinned || session.globalPinned) {
        return false
    }
    if (mode === 'jobs') {
        return hasRunningAttachedJob(session)
    }
    return hasRunningAttachedJob(session)
        || hasAgentInProgressActivity(session)
        || (session.active === true
            && !hasAgentForegroundWork(session)
            && (session.pendingRequestsCount ?? 0) === 0)
}

/**
 * Fires the arrival alert when a session *becomes* blocked (#1717).
 *
 * Keyed on session ids rather than the count, because a count alone cannot
 * tell "one resolved, another arrived" from "nothing happened" — that swap
 * nets to zero and would silently skip the alert on the new blocker.
 *
 * The alert deadline is state, not a timer owned by this effect: the blocked
 * id list churns constantly at fleet scale, and an effect that re-runs would
 * otherwise cancel its own pending clear and leave the counter pulsing
 * forever.
 *
 * `ready` gates the baseline. The router mounts this list with `sessions={[]}`
 * while `/sessions` is in flight, so seeding on the literal first render would
 * make every cold page load read its entire pre-existing backlog as brand new
 * and — in sound mode — buzz at you on every refresh.
 */
function useBlockedArrivalAlert(
    blockedIds: string[],
    mode: BlockedAlertMode,
    ready: boolean
): boolean {
    const [alertUntil, setAlertUntil] = useState(0)
    const [now, setNow] = useState(0)
    const seenRef = useRef<Set<string> | null>(null)

    const key = blockedIds.join(',')
    useEffect(() => {
        if (!ready) return
        const current = new Set(blockedIds)
        const seen = seenRef.current
        seenRef.current = current

        if (seen === null) return
        const arrived = blockedIds.some(id => !seen.has(id))
        if (!arrived || mode === 'count') return

        setAlertUntil(Date.now() + BLOCKED_ALERT_PULSE_MS)
        if (mode === 'sound') playBlockedAlertSound()
    }, [key, mode, ready]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (alertUntil === 0) return
        const remaining = alertUntil - Date.now()
        if (remaining <= 0) {
            setAlertUntil(0)
            return
        }
        const timer = setTimeout(() => {
            setAlertUntil(0)
            setNow(value => value + 1)
        }, remaining)
        return () => clearTimeout(timer)
    }, [alertUntil])

    void now
    return alertUntil > 0
}

export type BlockedJumpDirection = 'none' | 'up' | 'down' | 'both'

const BLOCKED_DIRECTION_GLYPH: Record<BlockedJumpDirection, string | null> = {
    none: null,
    up: '\u2191',
    down: '\u2193',
    both: '\u2195'
}

function BlockedFilterIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
        </svg>
    )
}

function BlockedFlagIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <path d="M4 21V4h13l-2 4 2 4H4" />
        </svg>
    )
}

/**
 * Always-visible blocked counter (#1717).
 *
 * This is the off-viewport answer. Edge chevrons cannot do this job: the
 * session list collapses directory groups and caps each group's preview, so a
 * blocked row is frequently not merely scrolled out of view but absent from
 * the DOM entirely — a "scroll down" hint would strand the operator on a
 * collapsed header. A header counter is always on screen, states a number, and
 * its click makes the row reachable before travelling to it.
 *
 * Deliberately a plain action button, not a toggle: the blocked-only lens is
 * its own sibling control below, so keyboard and assistive activation reach
 * both behaviours natively rather than depending on a long-press gesture.
 */
function BlockedJumpPill(props: {
    count: number
    direction: BlockedJumpDirection
    /** Briefly true after a NEW blocker arrives — see `useBlockedArrivalAlert`. */
    alerting: boolean
    onJump: () => void
}) {
    const { t } = useTranslation()
    const glyph = BLOCKED_DIRECTION_GLYPH[props.direction]
    const label = t('sessions.blocked.jump', { count: props.count })

    return (
        <button
            type="button"
            onClick={props.onJump}
            data-testid="blocked-jump-pill"
            title={label}
            aria-label={label}
            className={cn(
                'flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                'border-[var(--app-badge-warning-border)] text-[var(--app-badge-warning-text)] hover:bg-[var(--app-badge-warning-bg)]',
                // Pulse only on arrival, never continuously: a permanent pulse
                // at fleet scale is wallpaper within a day, and this needs to
                // still mean something on day 200.
                props.alerting ? 'bg-[var(--app-badge-warning-bg)] animate-blocked-alert' : ''
            )}
        >
            <BlockedFlagIcon className="h-3.5 w-3.5" />
            <span>{props.count}</span>
            {glyph ? <span aria-hidden="true">{glyph}</span> : null}
        </button>
    )
}

/** Blocked-only lens, mirroring the existing unread-only header toggle. */
function BlockedLensToggle(props: {
    active: boolean
    count: number
    onToggle: () => void
}) {
    const { t } = useTranslation()
    const label = props.active
        ? t('sessions.blockedFilter.showingOnly', { count: props.count })
        : t('sessions.blockedFilter.hint')

    return (
        <button
            type="button"
            onClick={props.onToggle}
            data-testid="blocked-lens-toggle"
            aria-pressed={props.active}
            title={label}
            aria-label={label}
            className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                props.active
                    ? 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'
            )}
        >
            <BlockedFilterIcon className="h-4 w-4" />
        </button>
    )
}

export type SessionTimeRange = {
    start: number | null
    end: number | null
}

function parseLocalDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
}

export function getSessionTimeRange(start: string, end: string): SessionTimeRange | null {
    const startDate = parseLocalDate(start)
    const endDate = parseLocalDate(end)
    if (!startDate || !endDate) return null
    if (endDate) endDate.setDate(endDate.getDate() + 1)
    return { start: startDate.getTime(), end: endDate.getTime() }
}

export function sessionMatchesTimeRange(session: SessionSummary, range: SessionTimeRange | null): boolean {
    if (!range) return true
    if (range.start !== null && session.updatedAt < range.start) return false
    if (range.end !== null && session.updatedAt >= range.end) return false
    return true
}

function SessionsEmptyState(props: {
    onNewSession: () => void
    onBrowse?: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--app-hint)] opacity-60"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 14h8" />
                <path d="M8 17h5" />
            </svg>
            <div className="text-base font-medium text-[var(--app-fg)]">
                {t('sessions.empty.title')}
            </div>
            <div className="max-w-sm text-sm text-[var(--app-hint)]">
                {t('sessions.empty.hint')}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
                >
                    {t('sessions.empty.startSession')}
                </button>
                {props.onBrowse && (
                    <button
                        type="button"
                        onClick={props.onBrowse}
                        className="px-4 py-1.5 text-sm rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('sessions.empty.browse')}
                    </button>
                )}
            </div>
        </div>
    )
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    hasActiveSession: boolean
    latestUpdatedAt: number
}

function usesWindowsSeparators(path: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path)
}

function stripTrailingSeparators(path: string): string {
    if (!usesWindowsSeparators(path)) {
        if (/^\/+$/.test(path)) return '/'
        return path.replace(/\/+$/, '')
    }
    if (/^[A-Za-z]:[\\/]+$/.test(path)) return path.slice(0, 3)
    return path.replace(/[\\/]+$/, '')
}

function normalizePathForCompare(path: string): string {
    const stripped = stripTrailingSeparators(path)
    return usesWindowsSeparators(path) ? stripped.replace(/\\/g, '/') : stripped
}

function pathIsUnder(parent: string, child: string): boolean {
    const parentNorm = normalizePathForCompare(parent)
    const childNorm = normalizePathForCompare(child)
    return childNorm === parentNorm || childNorm.startsWith(`${parentNorm}/`)
}

export type SessionGroupDirectorySource = {
    path?: string | null
    worktree?: { basePath?: string | null; worktreePath?: string | null } | null
}

/**
 * Directory used as the sidebar project-group key.
 *
 * Prefer worktree.basePath when the session path lives under it. When basePath
 * is a realpath of a symlink prefix (CLI realpaths worktreePath/basePath while
 * metadata.path may still use the logical spelling), require worktreePath to
 * sit under basePath before rewriting the group root from path — display-name
 * collision alone is not alias evidence.
 */
export function resolveSessionGroupDirectory(source: SessionGroupDirectorySource): string {
    // Do not trim(): trailing/leading spaces are valid POSIX path characters and
    // group.directory feeds Copy Path / New Session.
    const path = source.path ?? ''
    const basePath = source.worktree?.basePath ?? ''
    const worktreePath = source.worktree?.worktreePath ?? ''
    if (!basePath && !path) return 'Other'
    if (!basePath) return stripTrailingSeparators(path)
    if (!path) return stripTrailingSeparators(basePath)

    const normBase = stripTrailingSeparators(basePath)
    if (pathIsUnder(normBase, path)) {
        return normBase
    }

    // Alias evidence: realpathed worktreePath under realpathed basePath, while
    // path still uses a logical spelling of the same checkout.
    if (!worktreePath || !pathIsUnder(normBase, worktreePath)) {
        return normBase
    }

    const baseNorm = normalizePathForCompare(normBase)
    const worktreeNorm = normalizePathForCompare(worktreePath)
    const pathNorm = normalizePathForCompare(path)
    const suffix = worktreeNorm.slice(baseNorm.length)
    if (!suffix) return normBase

    const suffixIndex = pathNorm.lastIndexOf(`${suffix}/`)
    if (suffixIndex !== -1) {
        const logicalRoot = pathNorm.slice(0, suffixIndex)
        return usesWindowsSeparators(path) ? logicalRoot.replace(/\//g, '\\') : logicalRoot
    }
    if (pathNorm.endsWith(suffix)) {
        const logicalRoot = pathNorm.slice(0, -suffix.length) || normBase
        return usesWindowsSeparators(path) ? logicalRoot.replace(/\//g, '\\') : logicalRoot
    }
    return normBase
}

export const UNKNOWN_MACHINE_ID = '__unknown__'
export const GROUP_SESSION_PREVIEW_LIMIT = DEFAULT_SESSION_PREVIEW_LIMIT

export function getSessionDedupKey(session: SessionSummary): string | null {
    const agentId = session.metadata?.agentSessionId?.trim()
    if (!agentId) return null
    // Scope by flavor: agentSessionId is flattened from native ids and can retain a
    // stale cross-flavor value (codexSessionId ?? claudeSessionId ?? ...).
    return `${session.metadata?.flavor ?? 'unknown'}:${agentId}`
}

export function deduplicateSessionsByAgentId(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    const byAgentId = new Map<string, SessionSummary[]>()
    const result: SessionSummary[] = []

    for (const session of sessions) {
        const dedupKey = getSessionDedupKey(session)
        if (!dedupKey) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(dedupKey)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(dedupKey, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            // Preserve an explicit pin when otherwise choosing by recency
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

export function isSidebarEmptySessionStub(session: SessionSummary): boolean {
    if (session.active) return false
    const meta = session.metadata
    if (!meta) return true
    if (meta.agentSessionId?.trim()) return false
    if (hasSessionTitleSignal(session)) return false
    return true
}

export function shouldShowSessionInSidebar(session: SessionSummary, selectedSessionId?: string | null): boolean {
    if (session.id === selectedSessionId) return true
    if (session.active || session.pinned || session.globalPinned) return true
    return !isSidebarEmptySessionStub(session)
}

/** Global durable pin — floats into the top Pinned sessions band. */
export function isExplicitlyPinnedSession(session: SessionSummary): boolean {
    return Boolean(session.globalPinned)
}

/** Sort for the global top Pinned band: pending/active first, then recency. */
export function sortGlobalPinnedSessions(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => {
        const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
        const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
        if (rankA !== rankB) return rankA - rankB
        return b.updatedAt - a.updatedAt
    })
}

/**
 * Lift durable pins into a flat top band; omit them from project groups.
 * In-progress preference still applies only to the unpinned remainder.
 */
export function partitionGlobalPinnedSessions(sessions: SessionSummary[]): {
    pinned: SessionSummary[]
    unpinned: SessionSummary[]
} {
    const pinned: SessionSummary[] = []
    const unpinned: SessionSummary[] = []
    for (const session of sessions) {
        if (isExplicitlyPinnedSession(session)) {
            pinned.push(session)
        } else {
            unpinned.push(session)
        }
    }
    return { pinned: sortGlobalPinnedSessions(pinned), unpinned }
}

export function prepareSidebarSessions(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return deduplicateSessionsByAgentId(sessions, selectedSessionId)
        .filter(session => shouldShowSessionInSidebar(session, selectedSessionId))
}

// "Active sessions only" view: hide inactive sessions, but never hide the one the
// operator currently has open — otherwise toggling the filter would yank the
// selected session out from under them. Idle sessions with a running attached
// job stay visible too — that is the headline use case for session jobs.
export function filterActiveSessionsOnly(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return sessions.filter(session =>
        session.active
        || session.id === selectedSessionId
        || hasRunningAttachedJob(session)
    )
}

// Transient unread lens: hide sessions the operator has already seen.
// Keep the open session visible. Not Overseer / "needs attention" — just unread.
export function filterUnreadSessionsOnly(
    sessions: SessionSummary[],
    selectedSessionId: string | null | undefined,
    getLastSeenAt: (sessionId: string) => number
): SessionSummary[] {
    return sessions.filter(session =>
        session.id === selectedSessionId
        || sessionIsUnread(session, { lastSeenAt: getLastSeenAt(session.id) })
    )
}

// Paginated session previews move one batch at a time in either direction.
// Counts always stay within the configured preview floor and the group total.
export function getNextSessionVisibleCount(current: number, step: number, total: number): number {
    return Math.min(current + Math.max(1, step), total)
}

export function getPreviousSessionVisibleCount(current: number, step: number): number {
    const normalizedStep = Math.max(1, step)
    return Math.max(normalizedStep, current - normalizedStep)
}

export function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const path = resolveSessionGroupDirectory(session.metadata ?? {})
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? UNKNOWN_MACHINE_ID}::${path}`
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: []
            })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = [...group.sessions].sort((a, b) => {
                // Project pins stay first inside the folder (#1457 / intra-group only).
                if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = group.sessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = group.sessions.some(s => s.active)
            const hasPinnedSession = group.sessions.some(s => s.pinned || s.globalPinned)
            const displayName = getGroupDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession,
                hasPinnedSession
            }
        })
        .sort((a, b) => {
            if (a.hasPinnedSession !== b.hasPinnedSession) {
                return a.hasPinnedSession ? -1 : 1
            }
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}


export function expandSelectedSessionCollapseOverrides(
    overrides: Map<string, boolean>,
    group: { key: string }
): Map<string, boolean> {
    // Keep auto-expanded paths open after selection moves so content above the
    // clicked row does not collapse and displace the sidebar viewport.
    if (overrides.get(group.key) === false) {
        return overrides
    }

    const next = new Map(overrides)
    next.set(group.key, false)
    return next
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    for (const g of groups) {
        const key = g.machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId: g.machineId,
                label: resolveMachineLabel(g.machineId),
                projectGroups: [],
                totalSessions: 0,
                hasActiveSession: false,
                latestUpdatedAt: 0,
            }
            map.set(key, mg)
        }
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.hasActiveSession) mg.hasActiveSession = true
        if (g.latestUpdatedAt > mg.latestUpdatedAt) mg.latestUpdatedAt = g.latestUpdatedAt
    }
    return [...map.values()].sort((a, b) => {
        if (a.hasActiveSession !== b.hasActiveSession) return a.hasActiveSession ? -1 : 1
        return b.latestUpdatedAt - a.latestUpdatedAt
    })
}

function CopyPathButton({ path, className }: { path: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-[var(--app-badge-success-text)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'} ${className ?? ''}`}
            title={copied ? 'Copied!' : `Copy: ${path}`}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5" />
                : <CopyIcon className="h-3.5 w-3.5" />
            }
        </button>
    )
}


function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}


function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function SessionPreviewArrowIcon(props: { direction: 'up' | 'down'; className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            {props.direction === 'up' ? (
                <path d="M12 19V5m-6 6 6-6 6 6" />
            ) : (
                <path d="M12 5v14m6-6-6 6-6-6" />
            )}
        </svg>
    )
}

export { getSessionTitle } from '@/lib/sessionTitle'

export function normalizeSearch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

export function sessionMatchesQuery(session: SessionSummary, query: string, machineLabel: string): boolean {
    if (!query) return true
    const searchableParts = [
        getSessionTitle(session),
        getWorktreeSessionLabel(session),
        session.id,
        session.metadata?.path,
        session.metadata?.worktree?.basePath,
        session.metadata?.worktree?.worktreePath,
        session.metadata?.name,
        session.metadata?.summary?.text,
        session.metadata?.flavor,
        machineLabel,
    ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
    if (isWildcardSearch(query)) {
        return searchableParts.some((part) => matchesSearchQuery(part, query))
    }
    return searchableParts.join('\n').toLowerCase().includes(query)
}

export function shouldShowPinnedDivider(sessions: SessionSummary[], index: number): boolean {
    if (index <= 0 || index >= sessions.length) return false
    return Boolean(sessions[index - 1]?.pinned) && !sessions[index]?.pinned
}

export function getVisibleSessionPreview(
    sessions: SessionSummary[],
    options: {
        expanded?: boolean
        selectedSessionId?: string | null
        limit?: number
    } = {}
): SessionSummary[] {
    const limit = options.limit ?? GROUP_SESSION_PREVIEW_LIMIT
    if (options.expanded || sessions.length <= limit) return sessions

    const requiredIds = new Set<string>()
    for (const session of sessions) {
        if (session.pendingRequestsCount > 0) requiredIds.add(session.id)
    }
    if (options.selectedSessionId && sessions.some(session => session.id === options.selectedSessionId)) {
        requiredIds.add(options.selectedSessionId)
    }

    const visible: SessionSummary[] = sessions.filter((session, index) => {
        return index < limit || requiredIds.has(session.id)
    })

    for (let index = visible.length - 1; visible.length > limit && index >= 0; index -= 1) {
        const session = visible[index]
        if (!session || requiredIds.has(session.id)) continue
        visible.splice(index, 1)
    }

    return visible
}

function CalendarIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
    )
}

function formatDateValue(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function SessionDateRangePicker(props: {
    start: string
    end: string
    sessionActivityDates: ReadonlySet<string>
    onChange: (start: string, end: string) => void
    onClear: () => void
    onClose: () => void
    align: 'left' | 'right'
}) {
    const { t } = useTranslation()
    const initialDate = parseLocalDate(props.start) ?? new Date()
    const [visibleMonth, setVisibleMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
    const today = formatDateValue(new Date())
    const firstWeekday = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay()
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
    const weekdays = Array.from({ length: 7 }, (_, day) => (
        new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2026, 5, 7 + day))
    ))

    const selectDate = (value: string) => {
        if (!props.start || props.end) {
            props.onChange(value, '')
            return
        }
        props.onChange(value < props.start ? value : props.start, value < props.start ? props.start : value)
        props.onClose()
    }

    return (
        <div className={cn(
            'absolute top-full z-30 mt-2 w-72 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 shadow-xl',
            props.align === 'left' ? 'left-0' : 'right-0'
        )}>
            <div className="mb-2 flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.previousMonth')}
                >
                    <span aria-hidden="true">‹</span>
                </button>
                <div className="text-sm font-medium">
                    {visibleMonth.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                </div>
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.nextMonth')}
                >
                    <span aria-hidden="true">›</span>
                </button>
            </div>
            <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-[var(--app-hint)]">
                {weekdays.map((weekday, index) => <div key={`${weekday}-${index}`} className="py-1">{weekday}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)
                    const value = formatDateValue(date)
                    const isToday = value === today
                    const isEndpoint = value === props.start || value === props.end
                    const isInRange = Boolean(props.start && props.end && value > props.start && value < props.end)
                    const hasSessionActivity = props.sessionActivityDates.has(value)
                    const dateLabel = date.toLocaleDateString()
                    const activityLabel = hasSessionActivity
                        ? t('sessions.timeFilter.dayWithActivity', { date: dateLabel })
                        : dateLabel
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => selectDate(value)}
                            aria-label={activityLabel}
                            aria-current={isToday ? 'date' : undefined}
                            title={hasSessionActivity ? activityLabel : undefined}
                            className={cn(
                                'h-8 rounded-lg text-xs transition-colors',
                                isEndpoint && 'bg-[var(--app-button)] text-[var(--app-button-text)]',
                                isInRange && 'bg-[var(--app-link)]/15 text-[var(--app-link)]',
                                !isEndpoint && !isInRange && isToday && 'bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && hasSessionActivity && 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && !hasSessionActivity && 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'
                            )}
                        >
                            {index + 1}
                        </button>
                    )
                })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--app-divider)] pt-2 text-xs">
                <span className="text-[var(--app-hint)]">
                    {!props.start
                        ? t('sessions.timeFilter.pickStart')
                        : !props.end
                            ? t('sessions.timeFilter.pickEnd')
                            : `${props.start} – ${props.end}`}
                </span>
                {props.start ? (
                    <button type="button" onClick={props.onClear} className="text-[var(--app-link)]">
                        {t('sessions.timeFilter.clear')}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

// On-device speech recognition (notably Android's) appends sentence-ending
// punctuation the user never said — "Jessica" comes back as "Jessica." — which
// then fails to substring-match anything. A search query is never a sentence,
// so trailing `.`/`!`/`?` from dictation is always noise, not intent.
function stripDictationTrailingPunctuation(text: string): string {
    return text.replace(/[.!?]+\s*$/, '')
}

export function SessionListSearch(props: {
    value: string
    onChange: (value: string) => void
    customStart: string
    customEnd: string
    sessionActivityDates: ReadonlySet<string>
    onDateRangeChange: (start: string, end: string) => void
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const [datePickerOpen, setDatePickerOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const collapsedButtonRef = useRef<HTMLButtonElement>(null)
    const dateButtonRef = useRef<HTMLButtonElement>(null)
    const hasDateRange = Boolean(props.customStart && props.customEnd)

    useEffect(() => {
        if (props.expanded) {
            inputRef.current?.focus()
        } else {
            setDatePickerOpen(false)
        }
    }, [props.expanded])

    const renderDateFilter = (variant: 'standalone' | 'embedded') => {
        const returnFocus = () => {
            (variant === 'embedded' ? inputRef.current : dateButtonRef.current)?.focus()
        }

        return (
            <>
                <button
                    ref={dateButtonRef}
                    type="button"
                    onClick={() => setDatePickerOpen(open => !open)}
                    className={cn(
                        'relative shrink-0 transition-colors hover:bg-[var(--app-subtle-bg)]',
                        variant === 'standalone'
                            ? 'rounded-full p-1.5 hover:text-[var(--app-fg)]'
                            : 'flex items-center rounded-r-lg rounded-l-md px-1',
                        hasDateRange ? 'text-[var(--app-link)]' : 'text-[var(--app-hint)]'
                    )}
                    title={hasDateRange ? `${props.customStart} – ${props.customEnd}` : t('sessions.timeFilter.label')}
                    aria-label={hasDateRange
                        ? `${t('sessions.timeFilter.label')}: ${props.customStart} – ${props.customEnd}`
                        : t('sessions.timeFilter.label')}
                    aria-expanded={datePickerOpen}
                >
                    <CalendarIcon className="h-5 w-5" />
                    {hasDateRange ? (
                        <span className={cn(
                            'absolute h-1.5 w-1.5 rounded-full bg-[var(--app-link)]',
                            variant === 'standalone' ? 'right-0.5 top-0.5' : 'right-1 top-1'
                        )} />
                    ) : null}
                </button>
                {datePickerOpen ? (
                    <>
                        <button
                            type="button"
                            aria-label={t('sessions.timeFilter.close')}
                            className="fixed inset-0 z-20 cursor-default"
                            onClick={() => {
                                setDatePickerOpen(false)
                                returnFocus()
                            }}
                        />
                        <SessionDateRangePicker
                            start={props.customStart}
                            end={props.customEnd}
                            sessionActivityDates={props.sessionActivityDates}
                            onChange={props.onDateRangeChange}
                            onClear={() => {
                                props.onDateRangeChange('', '')
                                // The footer Clear button unmounts once the range is
                                // empty; return focus so it does not drop to <body>.
                                returnFocus()
                            }}
                            onClose={() => {
                                setDatePickerOpen(false)
                                returnFocus()
                            }}
                            align={variant === 'standalone' ? 'left' : 'right'}
                        />
                    </>
                ) : null}
            </>
        )
    }

    const searchLabel = t('sessions.search.open')
    const hasTextQuery = props.value.length > 0

    // getCurrentText reads from a ref, not props.value directly, so dictation's
    // onFinalTranscript always appends onto the latest query even if this
    // component re-rendered mid-recording.
    const valueRef = useRef(props.value)
    valueRef.current = props.value
    const getCurrentValue = useCallback(() => valueRef.current, [])

    const voiceInput = useVoiceInputPreferences(props.api)
    const onDictationTextChange = useCallback((text: string) => {
        props.onChange(stripDictationTrailingPunctuation(text))
    }, [props.onChange])
    const dictation = useDictation({
        api: props.api,
        provider: voiceInput.provider,
        mode: voiceInput.transcriptionMode,
        getCurrentText: getCurrentValue,
        onTextChange: onDictationTextChange
    })
    const dictationListening = dictation.status === 'connecting' || dictation.status === 'connected'
    // Only true while a hold we actually started with dictation is still live —
    // guards the hold-end/press-end handlers so a press that never started
    // dictation (unconfigured provider) does not call toggle()/cancel().
    const dictationHoldActiveRef = useRef(false)
    // True only once the press has been confirmed as a deliberate hold (past
    // the threshold) — gates the "Listening…" UI so the pulsing dot never
    // flashes during the speculative pre-threshold window below, even though
    // dictation itself may already be connecting by then (see onPressStart).
    const [holdConfirmed, setHoldConfirmed] = useState(false)

    const holdToTalkHandlers = useHoldToTalk({
        // Start capturing audio the instant the press begins, not once the
        // threshold confirms a hold. getUserMedia + MediaRecorder setup is
        // real, unavoidable latency (tens to hundreds of ms) — deferring it
        // until onHoldStart meant a short word could be entirely spoken
        // before recording had even begun. Starting speculatively here and
        // discarding via onPressEnd/cancel() if it turns out to be a tap
        // keeps the same tap behavior while erasing that dead time for a
        // genuine hold.
        onPressStart: () => {
            if (!dictation.supported) return
            dictationHoldActiveRef.current = true
            void dictation.toggle()
        },
        onHoldStart: () => {
            if (dictationHoldActiveRef.current) setHoldConfirmed(true)
        },
        onHoldEnd: () => {
            // Release is both the stop and the apply — reveal the field with
            // whatever the transcript resolves to, no separate confirm step.
            setHoldConfirmed(false)
            props.onExpandedChange(true)
            if (dictationHoldActiveRef.current) {
                dictationHoldActiveRef.current = false
                void dictation.toggle()
            }
        },
        onPressEnd: () => {
            // Never became a deliberate hold (tap, drag-off, or cancel before
            // the threshold) — discard the speculative capture without ever
            // sending it for transcription.
            if (dictationHoldActiveRef.current) {
                dictationHoldActiveRef.current = false
                dictation.cancel()
            }
        },
        onTap: () => props.onExpandedChange(true),
        // Shorter than useHoldToTalk's 500ms default: this only needs to
        // disambiguate tap vs. hold now, since the actual recording already
        // started at press-down above — it no longer gates when capture begins.
        threshold: 200,
    })

    if (!props.expanded) {
        const collapsedLabel = holdConfirmed
            ? t('sessions.search.dictationActive')
            : hasTextQuery ? `${searchLabel}: ${props.value}` : searchLabel
        // Deliberately excludes dictationListening: resizing the button mid-hold
        // (e.g. from a small round icon to a wider chip) reflows its bounding
        // box under a still-pressed mouse cursor, firing a spurious mouseleave
        // that stops the recording almost as soon as it starts. The chip only
        // grows for an existing query, which is stable before the hold begins.
        const showsChip = hasTextQuery
        return (
            <div className="relative flex items-center gap-1">
                <div className={cn(
                    'relative flex min-w-0 items-center rounded-full transition-colors',
                    showsChip
                        // Keep the query and its clear action inside the same compact chip.
                        ? 'max-w-[9rem] bg-[var(--app-chat-user-chip-bg)] text-[var(--app-chat-user-chip-fg)]'
                        : 'shrink-0'
                )}>
                    <button
                        ref={collapsedButtonRef}
                        type="button"
                        {...holdToTalkHandlers}
                        className={cn(
                            'relative flex min-w-0 items-center gap-1 transition-colors',
                            showsChip
                                ? 'flex-1 rounded-l-full bg-[var(--app-chat-user-chip-bg)] px-2 py-1 text-[var(--app-chat-user-chip-fg)] hover:opacity-90'
                                : 'shrink-0 rounded-full p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                        )}
                        title={collapsedLabel}
                        aria-label={collapsedLabel}
                    >
                        {holdConfirmed ? (
                            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#007AFF]" aria-hidden="true" />
                        ) : (
                            <SearchIcon className="h-5 w-5 shrink-0" />
                        )}
                        {hasTextQuery ? (
                            <span className="min-w-0 truncate text-xs font-medium">{props.value}</span>
                        ) : null}
                    </button>
                    {hasTextQuery ? (
                        <button
                            type="button"
                            onClick={() => {
                                props.onChange('')
                                // The clear button unmounts with the query; keep focus on
                                // the collapsed search trigger instead of dropping to body.
                                collapsedButtonRef.current?.focus()
                            }}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r-full bg-[var(--app-chat-user-chip-action-bg)] text-[var(--app-chat-user-chip-action-fg)] transition-colors hover:text-[var(--app-chat-user-chip-action-hover-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-inset"
                            title={t('sessions.search.clear')}
                            aria-label={t('sessions.search.clear')}
                        >
                            <XIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
                {renderDateFilter('standalone')}
            </div>
        )
    }

    return (
        <div
            className="relative min-w-0 flex-1"
            onBlur={(event) => {
                // Losing focus while a hold's transcript is still being applied
                // must not collapse the field out from under it.
                if (dictationListening) return
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    props.onExpandedChange(false)
                }
            }}
        >
            {dictationListening ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-y-0 left-2.5 flex items-center text-[#007AFF]"
                >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#007AFF]" />
                    <span className="sr-only">{t('sessions.search.dictationActive')}</span>
                </div>
            ) : (
                <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--app-hint)]">
                    <SearchIcon className="h-3.5 w-3.5" />
                </div>
            )}
            <input
                ref={inputRef}
                type="search"
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                // Disabled while a released hold is still being transcribed —
                // this is the "wait" state the operator asked for: visually
                // inert until the transcript resolves and search applies.
                disabled={dictationListening}
                aria-busy={dictationListening}
                placeholder={dictationListening ? t('sessions.search.dictationProcessing') : t('sessions.search.placeholder')}
                aria-label={searchLabel}
                title={searchLabel}
                className={cn(
                    'w-full appearance-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-8 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] [text-overflow:ellipsis] focus:border-[var(--app-link)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
                    props.value ? 'pr-16' : 'pr-7',
                    dictationListening ? 'cursor-wait opacity-70' : null
                )}
            />
            {props.value ? (
                <button
                    type="button"
                    onClick={() => {
                        props.onChange('')
                        // The clear button unmounts with the query; keep focus off <body>
                        // so a later outside click still routes blur through the wrapper.
                        inputRef.current?.focus()
                    }}
                    className="absolute inset-y-0 right-9 flex items-center rounded p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    title={t('sessions.search.clear')}
                >
                    <XIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
            <div className="absolute inset-y-0 right-0 flex items-stretch">
                {renderDateFilter('embedded')}
            </div>
            {dictationListening && dictation.partialTranscript ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-x-0 top-full z-10 mt-1 max-h-20 overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] shadow-sm"
                >
                    {dictation.partialTranscript}
                </div>
            ) : null}
            {dictation.error ? (
                <div
                    role="alert"
                    className="absolute inset-x-0 top-full z-10 mt-1 rounded-md bg-[var(--app-subtle-bg)] px-3 py-2 text-xs text-red-600"
                >
                    {dictation.error}
                </div>
            ) : null}
        </div>
    )
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    titleSuggestionAvailable?: boolean
    selected?: boolean
    showDetailedStatus?: boolean
    inRunningSection?: boolean
    projectLabel?: string
    machineLabel?: string
    lastSeenVersion: number
    /** Brief ring after jump-to-next-blocked, so the row the list travelled to
     *  is obvious once the scroll settles. */
    flashHighlight?: boolean
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const {
        session: s,
        onSelect,
        showPath = true,
        api,
        titleSuggestionAvailable = false,
        selected = false,
        showDetailedStatus = false,
        inRunningSection = false,
        projectLabel,
        machineLabel,
        lastSeenVersion,
        flashHighlight = false
    } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [linkPrOpen, setLinkPrOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const { features } = useFeatures(api)
    const githubPrAwarenessEnabled = Boolean(features?.githubPrAwareness.enabled)
    const primaryPrRef = getPrimaryGithubPrRef(s.metadata?.externalRefs)
    const {
        status: cursorChatStoreStatus,
        isApplicable: cursorChatStoreApplicable,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    } = useCursorChatStoreStatus({
        api,
        session: s,
        enabled: menuOpen
    })
    const cursorReopenGate = resolveCursorReopenGate({
        applicable: cursorChatStoreApplicable,
        onDisk: cursorChatStoreStatus?.onDisk,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    })
    const cursorReopenDisabledReason = cursorReopenGate.disabledReason === 'missing'
        ? t('session.action.reopenCursorMissing')
        : cursorReopenGate.disabledReason === 'checking'
            ? t('session.action.reopenCursorChecking')
            : undefined
    const cursorReopenUnverifiedHint = cursorReopenGate.probeUnverified
        ? t('session.action.reopenCursorUnverified')
        : undefined

    const { archiveSession, reopenSession, renameSession, setExternalRefs, suggestSessionTitle, updateSessionSummary, deleteSession, setPinMode, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleSetPinMode = async (mode: 'none' | 'project' | 'global') => {
        try {
            await setPinMode(mode)
        } catch (error) {
            addToast({
                title: t('session.action.pinFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: s.id,
                url: `/sessions/${s.id}`
            })
        }
    }

    const handleReopen = async () => {
        setReopenError(null)
        try {
            const result = await reopenSession()
            // resumeSession may merge the row into a freshly-spawned sessionId.
            // Follow it so the operator lands on the live session.
            if (result.sessionId && result.sessionId !== s.id) {
                retargetSharePendingTransfer(s.id, result.sessionId)
                await transferComposerDraftThenNavigate(
                    s.id,
                    result.sessionId,
                    () => onSelect(result.sessionId),
                )
            }
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const linkedPr = useMemo(() => {
        if (!githubPrAwarenessEnabled || !primaryPrRef) return null
        const nowMs = Date.now()
        const display = resolveGithubPrChipDisplay(primaryPrRef, nowMs)
        const parts = formatGithubPrChipDetailParts(primaryPrRef, display, t, nowMs)
        return {
            glyph: parts.glyph,
            detail: parts.detail,
            href: primaryPrRef.url
        }
    }, [githubPrAwarenessEnabled, primaryPrRef, t])
    const attention = useMemo(
        () => showDetailedStatus
            ? classifySessionAttention(s, {
                selected,
                lastSeenAt: getSessionLastSeenAt(s.id),
                manualUnreadAt: getSessionManualUnreadAt(s.id)
            })
            : null,
        [s, selected, showDetailedStatus, lastSeenVersion]
    )
    // The rail lives on the button rather than inside SessionRowSummary so it
    // escapes the `opacity-50` disconnected-row treatment — a blocked agent
    // whose CLI dropped is precisely the one worth spotting.
    const blocked = getSessionBlockedState(s, { now: Date.now() })
    const hasScheduleTooltip = showDetailedStatus && s.futureScheduledMessageCount > 0
    const { attentionId, scheduleId, describedBy } = useSessionRowTooltipIds(
        Boolean(attention),
        hasScheduleTooltip
    )
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                data-session-id={s.id}
                data-session-blocked={blocked ? (blocked.stale ? 'stale' : 'active') : undefined}
                className={cn(
                    'session-list-item group/session-row flex w-full flex-col gap-1 py-2 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg',
                    // Reserve the rail width on every row so blocked rows do
                    // not shift their neighbours when the flag appears.
                    'border-l-2 pl-2',
                    blocked && blocked.stale
                        ? 'border-[var(--app-hint)]'
                        : blocked && sessionBlockedIsError(blocked)
                            ? 'border-[var(--app-badge-error-text)]'
                            : blocked
                                ? 'border-[var(--app-badge-warning-text)]'
                                : 'border-transparent',
                    flashHighlight ? 'ring-2 ring-[var(--app-badge-warning-text)]' : '',
                    selected ? 'bg-[var(--app-secondary-bg)]' : ''
                )}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
                aria-describedby={describedBy}
            >
                <SessionRowSummary
                    session={s}
                    showPath={showPath}
                    showDetailedStatus={showDetailedStatus}
                    selected={selected}
                    nestedTooltips
                    attentionTooltipId={attentionId}
                    lastSeenVersion={lastSeenVersion}
                    scheduleTooltipId={scheduleId}
                    inRunningSection={inRunningSection}
                    projectLabel={projectLabel}
                    machineLabel={machineLabel}
                    trailing={githubPrAwarenessEnabled && primaryPrRef ? (
                        <SessionPrChip refs={s.metadata?.externalRefs} />
                    ) : null}
                />
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionId={s.id}
                sessionTitle={sessionName}
                sessionActive={s.active}
                sessionPinned={Boolean(s.pinned) && !Boolean(s.globalPinned)}
                sessionGlobalPinned={Boolean(s.globalPinned)}
                onSetPinMode={(mode) => void handleSetPinMode(mode)}
                onRename={() => setRenameOpen(true)}
                onLinkPr={githubPrAwarenessEnabled ? () => setLinkPrOpen(true) : undefined}
                linkedPr={linkedPr}
                onExport={() => setExportOpen(true)}
                onMarkUnread={() => markSessionUnread(s.id, s.updatedAt)}
                onArchive={() => setArchiveOpen(true)}
                onReopen={cursorReopenDisabledReason ? undefined : handleReopen}
                reopenDisabledReason={cursorReopenDisabledReason}
                reopenHint={cursorReopenUnverifiedHint}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                    centerTitle
                />
            ) : null}

            {renameOpen ? (
                <RenameSessionDialog
                    isOpen={true}
                    onClose={() => setRenameOpen(false)}
                    currentName={sessionName}
                    onRename={renameSession}
                    onSuggestTitle={api && titleSuggestionAvailable ? suggestSessionTitle : undefined}
                    onUpdateSummary={api && titleSuggestionAvailable ? updateSessionSummary : undefined}
                    isPending={isPending}
                />
            ) : null}

            <LinkPrDialog
                isOpen={linkPrOpen}
                onClose={() => setLinkPrOpen(false)}
                currentPrimaryLabel={primaryPrRef ? `${primaryPrRef.repo}#${primaryPrRef.number}` : null}
                onLink={setExternalRefs}
                onUnlink={primaryPrRef ? () => setExternalRefs([]) : undefined}
                isPending={isPending}
            />

            {exportOpen ? (
                <SessionExportDialog
                    isOpen={true}
                    onClose={() => setExportOpen(false)}
                    sessionId={s.id}
                    api={api}
                />
            ) : null}

            {archiveOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setArchiveOpen(false)}
                    title={t('dialog.archive.title')}
                    description={t('dialog.archive.description', { name: sessionName })}
                    confirmLabel={t('dialog.archive.confirm')}
                    confirmingLabel={t('dialog.archive.confirming')}
                    onConfirm={archiveSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}

            {deleteOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setDeleteOpen(false)}
                    title={t('dialog.delete.title')}
                    description={t('dialog.delete.description', { name: sessionName })}
                    confirmLabel={t('dialog.delete.confirm')}
                    confirmingLabel={t('dialog.delete.confirming')}
                    onConfirm={deleteSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}
        </>
    )
}

type PullToRefreshState = 'idle' | 'pulling' | 'ready'

const PULL_REFRESH_FEEDBACK_PX = 16
const PULL_REFRESH_TRIGGER_PX = 64

export function getPullToRefreshState(distancePx: number): PullToRefreshState {
    if (distancePx >= PULL_REFRESH_TRIGGER_PX) {
        return 'ready'
    }
    if (distancePx >= PULL_REFRESH_FEEDBACK_PX) {
        return 'pulling'
    }
    return 'idle'
}

export function getPullRefreshIndicatorRotation(state: PullToRefreshState): number {
    return state === 'ready' ? 180 : 0
}

function PullRefreshIcon(props: { rotation: number }) {
    return (
        <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform duration-200"
            viewBox="0 0 24 24"
            fill="none"
            style={{ transform: `rotate(${props.rotation}deg)` }}
        >
            <path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onNewSessionInDirectory?: (args: { machineId: string | null; directory: string }) => void
    onBrowse?: () => void
    onRefresh: () => Promise<unknown> | void
    isLoading: boolean
    renderHeader?: boolean
    headerActions?: React.ReactNode
    api: ApiClient | null
    titleSuggestionAvailable?: boolean
    machineLabelsById?: Record<string, string>
    machinesById?: Record<string, Machine>
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const {
        renderHeader = true,
        api,
        titleSuggestionAvailable = false,
        selectedSessionId,
        machineLabelsById = {},
        machinesById = {},
        onNewSessionInDirectory
    } = props
    const { sessionPreviewLimit } = useSessionPreviewLimit()
    const { sessionListStatusMode } = useSessionListStatusMode()
    const { showActiveSessionsOnly } = useShowActiveSessionsOnly()
    const lastSeenVersion = useSessionLastSeenVersion()
    // Transient unread lens — not a Settings preference. Cleared on reload; rows drop as they're seen.
    const [showUnreadOnly, setShowUnreadOnly] = useState(false)
    // Blocked lens + travel state (#1717). Transient for the same reason.
    const [showBlockedOnly, setShowBlockedOnly] = useState(false)
    const [blockedSectionCollapsed, setBlockedSectionCollapsed] = useState(false)
    const [pendingBlockedScrollId, setPendingBlockedScrollId] = useState<string | null>(null)
    const [flashBlockedSessionId, setFlashBlockedSessionId] = useState<string | null>(null)
    const [blockedOffscreen, setBlockedOffscreen] = useState<{ above: number; below: number }>(
        { above: 0, below: 0 }
    )
    const blockedJumpCursorRef = useRef(0)
    const { pinInProgressMode } = usePinInProgressSessions()
    const { blockedAlertMode } = useBlockedAlertMode()
    const { machineFilter, setMachineFilter } = useSessionListMachineFilter()
    const showDetailedStatus = sessionListStatusMode === 'detailed'
    const [searchQuery, setSearchQuery] = useState('')
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')
    const [, setCodexImportedSessionsVersion] = useState(0)
    const normalizedQuery = normalizeSearch(searchQuery)
    const timeRange = getSessionTimeRange(customStart, customEnd)
    const isFiltering = normalizedQuery.length > 0 || timeRange !== null

    useEffect(() => {
        // 中文注释：监听导入标记变化，让列表在“导入完成”或“用户已在 Hapi 中继续会话”后立即刷新时间文案。
        return subscribeCodexImportedSessions(() => {
            setCodexImportedSessionsVersion((value) => value + 1)
        })
    }, [])

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const allSessions = useMemo(
        () => {
            const prepared = prepareSidebarSessions(props.sessions, selectedSessionId)
            return showActiveSessionsOnly
                ? filterActiveSessionsOnly(prepared, selectedSessionId)
                : prepared
        },
        [props.sessions, selectedSessionId, showActiveSessionsOnly]
    )
    const sessionActivityDates = useMemo(
        () => new Set(allSessions.map(session => formatDateValue(new Date(session.updatedAt)))),
        [allSessions]
    )
    const visibleSessions = useMemo(
        () => isFiltering
            ? allSessions.filter(session => (
                sessionMatchesTimeRange(session, timeRange)
                && sessionMatchesQuery(
                    session,
                    normalizedQuery,
                    resolveMachineLabel(session.metadata?.machineId ?? null)
                )
            ))
            : allSessions,
        [allSessions, isFiltering, normalizedQuery, timeRange?.start, timeRange?.end, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const allGroups = useMemo(
        () => groupSessionsByDirectory(allSessions),
        [allSessions]
    )
    const machineFilters = useMemo(
        () => groupByMachine(allGroups, resolveMachineLabel),
        [allGroups, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const machineFilterItems = useMemo(
        () => machineFilters.map((mg) => {
            const machine = mg.machineId ? machinesById[mg.machineId] : undefined
            return {
                id: mg.machineId ?? UNKNOWN_MACHINE_ID,
                label: mg.label,
                sessionCount: mg.totalSessions,
                healthPresentation: presentMachineHealth(
                    machine?.health,
                    getMachinePlatform(machine)
                )
            }
        }),
        [machineFilters, machinesById]
    )
    const showMachineFilterBar = machineFilters.length >= 2
    // A persisted filter whose machine no longer has sessions falls back to
    // "All"; with at most one machine the bar is hidden and never filters.
    const activeMachineFilter = showMachineFilterBar && machineFilter !== null
        && machineFilters.some(mg => (mg.machineId ?? UNKNOWN_MACHINE_ID) === machineFilter)
        ? machineFilter
        : null
    // Unread after search/time, before machine scope — so machineFilters (from allSessions)
    // stay stable. Filtering unread into allSessions would drop machines with zero unread
    // and clear a persisted machine selection (showing other machines' unread instead).
    const unreadFilteredSessions = useMemo(() => {
        if (!showUnreadOnly) return visibleSessions
        const lastSeenById = getSessionLastSeenSnapshot()
        return filterUnreadSessionsOnly(
            visibleSessions,
            selectedSessionId,
            id => lastSeenById[id] ?? 0
        )
    }, [lastSeenVersion, visibleSessions, selectedSessionId, showUnreadOnly])
    // Blocked lens. Sits alongside the unread lens rather than inside it:
    // "you have not looked at this" and "it stopped and needs you" are
    // different questions, and a blocked session you already read is still
    // blocked.
    const blockedFilteredSessions = useMemo(() => {
        if (!showBlockedOnly) return unreadFilteredSessions
        const now = Date.now()
        return unreadFilteredSessions.filter(session =>
            session.id === selectedSessionId || sessionIsBlocked(session, { now })
        )
    }, [unreadFilteredSessions, showBlockedOnly, selectedSessionId])
    const machineFilteredSessions = useMemo(
        () => activeMachineFilter === null
            ? blockedFilteredSessions
            : blockedFilteredSessions.filter(session =>
                (session.metadata?.machineId ?? UNKNOWN_MACHINE_ID) === activeMachineFilter
            ),
        [blockedFilteredSessions, activeMachineFilter]
    )
    const { pinned: pinnedSessions, unpinned: unpinnedMachineSessions } = useMemo(
        () => partitionGlobalPinnedSessions(machineFilteredSessions),
        [machineFilteredSessions]
    )
    // Fleet-wide count, deliberately computed BEFORE search / time / unread /
    // machine narrowing: the pill exists to tell the operator how much blocked
    // work exists, and a count that silently shrank behind a filter would be
    // worse than no count at all. `jumpToNextBlocked` drops those filters when
    // it has to reach one of these rows.
    const blockedSessions = useMemo(() => {
        const now = Date.now()
        return allSessions
            .filter(session => sessionIsBlocked(session, { now }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }, [allSessions])
    const blockedCount = blockedSessions.length
    const blockedAlerting = useBlockedArrivalAlert(
        useMemo(() => blockedSessions.map(session => session.id), [blockedSessions]),
        blockedAlertMode,
        props.sessions.length > 0
    )

    // Rows for the pinned Blocked section. Globally pinned rows keep their own
    // section (the operator put them there on purpose) and still carry the
    // rail + chip where they sit.
    const blockedSectionSessions = useMemo(() => {
        const now = Date.now()
        return unpinnedMachineSessions
            .filter(session => sessionIsBlocked(session, { now }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }, [unpinnedMachineSessions])
    const blockedSectionIds = useMemo(
        () => new Set(blockedSectionSessions.map(session => session.id)),
        [blockedSectionSessions]
    )

    const runningSessions = useMemo(() => {
        const buckets: Record<RunningBucketKey, SessionSummary[]> = {
            jobs: [],
            working: [],
            pending: [],
            active: [],
        }
        if (pinInProgressMode === 'off') {
            return buckets
        }
        for (const session of unpinnedMachineSessions) {
            // Floated into the Blocked section instead. Without this a blocked
            // but still-connected agent renders twice — and worse, the quiet
            // grey "Active" bucket is exactly where it used to hide.
            if (blockedSectionIds.has(session.id)) {
                continue
            }
            if (!isPinnedInProgressSession(session, pinInProgressMode)) {
                continue
            }
            const agentWorking = hasAgentForegroundWork(session)
            const agentPending = session.active
                && (session.pendingRequestsCount ?? 0) > 0
                && !agentWorking
            if (agentWorking) {
                buckets.working.push(session)
            } else if (agentPending) {
                // Operator action outranks the Jobs meter when both apply.
                buckets.pending.push(session)
            } else if (hasRunningAttachedJob(session)) {
                buckets.jobs.push(session)
            } else {
                // Quiet but connected: finished executing, operator will continue.
                buckets.active.push(session)
            }
        }
        const byRecent = (a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt
        for (const key of Object.keys(buckets) as RunningBucketKey[]) {
            buckets[key].sort(byRecent)
        }
        return buckets
    }, [unpinnedMachineSessions, pinInProgressMode, blockedSectionIds])
    const runningSessionTotal = runningSessions.jobs.length
        + runningSessions.working.length
        + runningSessions.pending.length
    const activeSessionTotal = runningSessions.active.length
    const groups = useMemo(
        () => groupSessionsByDirectory(
            unpinnedMachineSessions.filter((session) => {
                if (blockedSectionIds.has(session.id)) return false
                if (pinInProgressMode !== 'off'
                    && isPinnedInProgressSession(session, pinInProgressMode)) return false
                return true
            })
        ),
        [unpinnedMachineSessions, pinInProgressMode, blockedSectionIds]
    )
    // Directory groups whose rows all floated to the pinned sections still
    // render an action-only header so copy-path / new-session-in-directory
    // stay available (no rows to group, but the project itself is live).
    // Based on the same machineFilteredSessions set as `groups` so machine /
    // unread filters stay consistent.
    const allDirectoryGroups = useMemo(
        () => groupSessionsByDirectory(
            machineFilteredSessions.filter((session) => !session.globalPinned)
        ),
        [machineFilteredSessions]
    )
    const actionOnlyGroups = useMemo(() => {
        // Under the blocked lens the operator asked for blocked rows and
        // nothing else; every directory would otherwise contribute a bare
        // action-only header, which is exactly the noise the lens removes.
        if (showBlockedOnly) {
            return []
        }
        // Otherwise also needed when the Blocked section (not the in-progress
        // pin) is what emptied a directory, or the project's copy-path /
        // new-session actions would vanish with its last row.
        if (pinInProgressMode === 'off' && blockedSectionIds.size === 0) {
            return []
        }
        const visibleKeys = new Set(groups.map((group) => group.key))
        return allDirectoryGroups.filter((group) => !visibleKeys.has(group.key))
    }, [groups, allDirectoryGroups, pinInProgressMode, blockedSectionIds, showBlockedOnly])
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const [runningSectionCollapsed, setRunningSectionCollapsed] = useState(false)
    const [activeSectionCollapsed, setActiveSectionCollapsed] = useState(false)
    const [pinnedSectionCollapsed, setPinnedSectionCollapsed] = useState(false)
    const autoExpandedSelectedSessionKeyRef = useRef<string | null>(null)
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        if (isFiltering) return false
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId)
            : false
        // Project pins should stay findable after reload (upstream #1115).
        return !group.hasActiveSession && !group.hasPinnedSession && !hasSelectedSession
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    // Per-group reveal cap for paginated session previews. Absent = the configured
    // preview limit; expand/collapse controls move the cap by one preview-sized batch.
    const [sessionVisibleCounts, setSessionVisibleCounts] = useState<Map<string, number>>(
        () => new Map()
    )

    const getGroupVisibleCount = (group: SessionGroup): number => {
        return sessionVisibleCounts.get(group.key) ?? sessionPreviewLimit
    }

    const showMoreSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const currentLimit = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const currentVisibleCount = getVisibleSessionPreview(group.sessions, {
                selectedSessionId,
                limit: currentLimit
            }).length
            next.set(group.key, getNextSessionVisibleCount(
                Math.max(currentLimit, currentVisibleCount),
                sessionPreviewLimit,
                group.sessions.length
            ))
            return next
        })
    }

    const showFewerSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const current = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const previous = getPreviousSessionVisibleCount(current, sessionPreviewLimit)
            if (previous <= sessionPreviewLimit) {
                next.delete(group.key)
            } else {
                next.set(group.key, previous)
            }
            return next
        })
    }

    const getVisibleGroupSessions = (group: SessionGroup): SessionSummary[] => {
        return getVisibleSessionPreview(
            group.sessions,
            {
                selectedSessionId,
                limit: getGroupVisibleCount(group)
            }
        )
    }

    const renderPinnedSection = ({
        sectionKey,
        titleKey,
        collapsed,
        onToggle,
        pulse,
        count,
        bucketKeys,
    }: {
        sectionKey: string
        titleKey: string
        collapsed: boolean
        onToggle: () => void
        pulse: boolean
        count: number
        bucketKeys: RunningBucketKey[]
    }) => {
        if (count === 0) {
            return null
        }
        return (
            <div key={sectionKey}>
                <div
                    className="group/running flex min-w-0 w-full select-none cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsed || isFiltering}
                    onClick={onToggle}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onToggle()
                        }
                    }}
                    title={t(titleKey)}
                >
                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={collapsed && !isFiltering} />
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                        <span className={`h-1.5 w-1.5 rounded-full bg-[var(--app-badge-success-text)] ${pulse ? 'animate-pulse' : ''}`} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {t(titleKey)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                        ({count})
                    </span>
                </div>
                <div className="collapsible-panel" data-open={(!collapsed || isFiltering) || undefined}>
                    <div className="collapsible-inner">
                    <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                        {bucketKeys.map((bucketKey) => {
                            const bucket = RUNNING_BUCKETS.find((b) => b.key === bucketKey)
                            const sessions = runningSessions[bucketKey]
                            if (!bucket || sessions.length === 0) {
                                return null
                            }
                            return (
                                <div key={bucketKey}>
                                    <div className={`flex items-center gap-1 px-1 pt-1 pb-0.5 text-[11px] font-medium ${bucket.colorClass}`}>
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${bucket.pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
                                        {t(bucket.labelKey)} ({sessions.length})
                                    </div>
                                    {sessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            titleSuggestionAvailable={titleSuggestionAvailable}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                            inRunningSection
                                            projectLabel={getGroupDisplayName(resolveSessionGroupDirectory(s.metadata ?? {}))}
                                            machineLabel={resolveMachineLabel(s.metadata?.machineId ?? null)}
                                            lastSeenVersion={lastSeenVersion}
                                        />
                                    ))}
                                </div>
                            )
                        })}
                    </div>
                    </div>
                </div>
            </div>
        )
    }

    const renderActionOnlyGroupHeader = (group: SessionGroup) => {
        // With multiple machines in the unfiltered view, disambiguate
        // same-named directories by suffixing the machine label.
        const groupTitle = showMachineFilterBar && activeMachineFilter === null
            ? `${group.displayName} · ${resolveMachineLabel(group.machineId)}`
            : group.displayName
        return (
            <div key={group.key}>
                <div
                    className="group/project sticky top-0 z-10 flex items-center gap-2 bg-[var(--app-bg)] py-1.5 pl-2 pr-2 text-left rounded-lg transition-colors hover:bg-[var(--app-secondary-bg)] min-w-0 w-full select-none"
                    title={group.directory}
                >
                    <span className="font-medium text-sm truncate flex-1">
                        {groupTitle}
                    </span>
                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                    {onNewSessionInDirectory && group.directory !== 'Other' ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                onNewSessionInDirectory({
                                    machineId: group.machineId,
                                    directory: group.directory
                                })
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] opacity-70 transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-link)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            title={t('sessions.group.new')}
                            aria-label={t('sessions.group.new')}
                        >
                            <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>
        )
    }

    const renderDirectoryGroup = (group: SessionGroup) => {
        const isCollapsed = isGroupCollapsed(group)
        const visibleGroupSessions = getVisibleGroupSessions(group)
        const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
        const currentLimit = Math.min(
            getGroupVisibleCount(group),
            group.sessions.length
        )
        const previousLimit = getPreviousSessionVisibleCount(currentLimit, sessionPreviewLimit)
        const previousGroupSessions = getVisibleSessionPreview(group.sessions, {
            selectedSessionId,
            limit: previousLimit
        })
        const collapseCount = visibleGroupSessions.length - previousGroupSessions.length
        const canShowFewerSessions = previousLimit < currentLimit && collapseCount > 0
        const expandCount = Math.min(sessionPreviewLimit, hiddenSessionCount)
        const canStartInGroupDirectory = group.directory !== 'Other'
        // With multiple machines in the unfiltered view, disambiguate
        // same-named directories by suffixing the machine label.
        const groupTitle = showMachineFilterBar && activeMachineFilter === null
            ? `${group.displayName} · ${resolveMachineLabel(group.machineId)}`
            : group.displayName
        return (
            <div key={group.key}>
                <div
                    className="group/project sticky top-0 z-10 flex items-center gap-2 bg-[var(--app-bg)] py-1.5 pl-2 pr-2 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] cursor-pointer min-w-0 w-full select-none"
                    onClick={() => toggleGroup(group.key, isCollapsed)}
                    title={group.directory}
                >
                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                    <span className="font-medium text-sm truncate flex-1">
                        {groupTitle}
                    </span>
                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                    {onNewSessionInDirectory && canStartInGroupDirectory ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                onNewSessionInDirectory({
                                    machineId: group.machineId,
                                    directory: group.directory
                                })
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] opacity-70 transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-link)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            title={t('sessions.group.new')}
                            aria-label={t('sessions.group.new')}
                        >
                            <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                    <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                        ({group.sessions.length})
                    </span>
                </div>

                {/* Sessions */}
                <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                    <div className="collapsible-inner">
                    <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                        {visibleGroupSessions.map((s, index) => (
                            <div key={s.id} className="contents">
                                {shouldShowPinnedDivider(visibleGroupSessions, index) ? (
                                    <div
                                        className="ml-2.5 mr-2 my-1 border-t border-[var(--app-border)]"
                                        aria-hidden="true"
                                    />
                                ) : null}
                                <SessionItem
                                    session={s}
                                    onSelect={props.onSelect}
                                    showPath={false}
                                    api={api}
                                    titleSuggestionAvailable={titleSuggestionAvailable}
                                    selected={s.id === selectedSessionId}
                                    showDetailedStatus={showDetailedStatus}
                                    lastSeenVersion={lastSeenVersion}
                                />
                            </div>
                        ))}
                        {group.sessions.length > sessionPreviewLimit && (hiddenSessionCount > 0 || canShowFewerSessions) ? (
                            <div className="ml-2.5 mr-2 my-1 flex gap-1.5">
                                {canShowFewerSessions ? (
                                    <button
                                        type="button"
                                        onClick={() => showFewerSessions(group)}
                                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    >
                                        <SessionPreviewArrowIcon direction="up" className="h-3 w-3 shrink-0" />
                                        {t('sessions.group.collapse', { n: collapseCount })}
                                    </button>
                                ) : null}
                                {hiddenSessionCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => showMoreSessions(group)}
                                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    >
                                        <SessionPreviewArrowIcon direction="down" className="h-3 w-3 shrink-0" />
                                        {t('sessions.group.expand', { n: expandCount })}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    </div>
                </div>
            </div>
        )
    }

    // Auto-expand group containing the selected session only when
    // the selected-session/group pair changes. Without this guard, every live
    // session-list refresh (for example tool-call updates from a running selected
    // session) reopens a path the user just collapsed.
    useEffect(() => {
        if (!selectedSessionId) {
            autoExpandedSelectedSessionKeyRef.current = null
            return
        }

        // Pinned "in progress" sessions are not rendered inside directory
        // groups, so only auto-expand when the selected session actually lives
        // in a visible group. Using `allGroups` here would expand the group
        // below whenever a running session is opened.
        const group = groups.find(g =>
            g.sessions.some(s => s.id === selectedSessionId)
        )
        if (!group) {
            // The selected session is not rendered inside any directory group
            // (e.g. it moved to the pinned "in progress" section). Drop the
            // guard so it auto-expands again when it transitions back into a
            // group later.
            autoExpandedSelectedSessionKeyRef.current = null
            return
        }

        const autoExpandKey = `${selectedSessionId}::${group.key}`
        if (autoExpandedSelectedSessionKeyRef.current === autoExpandKey) return
        autoExpandedSelectedSessionKeyRef.current = autoExpandKey

        setCollapseOverrides(prev => expandSelectedSessionCollapseOverrides(prev, group))
    }, [selectedSessionId, groups])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of allGroups) {
                knownKeys.add(g.key)
                knownKeys.add(`sessions::${g.key}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // Clean up reveal caps for groups that no longer exist.
    useEffect(() => {
        setSessionVisibleCounts(prev => {
            if (prev.size === 0) return prev
            const knownKeys = new Set(allGroups.map(g => g.key))
            const next = new Map(prev)
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // The search control unmounts when the list empties; reset the expansion so
    // it cannot suppress header actions (or re-expand on its own when sessions
    // return) while no search control is rendered.
    const showSearch = props.sessions.length > 0
    useEffect(() => {
        if (!showSearch) setSearchExpanded(false)
    }, [showSearch])

    const showHeaderRow = showSearch || renderHeader || Boolean(props.headerActions)

    // Pull-to-refresh on the scrollable list. Touch-only gesture mirroring the
    // pull-to-load-older pattern in HappyThread; desktop has no overscroll
    // bounce to make a wheel pull feel right, so it stays on live updates.
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [pullState, setPullState] = useState<PullToRefreshState>('idle')
    const pullStateRef = useRef<PullToRefreshState>('idle')
    const [isRefreshing, setIsRefreshing] = useState(false)
    const isRefreshingRef = useRef(false)
    const onRefreshRef = useRef(props.onRefresh)
    useEffect(() => {
        onRefreshRef.current = props.onRefresh
    }, [props.onRefresh])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        let pullStartY: number | null = null

        const updatePullState = (state: PullToRefreshState) => {
            if (pullStateRef.current === state) {
                return
            }
            pullStateRef.current = state
            setPullState(state)
        }

        const triggerRefresh = () => {
            if (isRefreshingRef.current) {
                return
            }
            isRefreshingRef.current = true
            setIsRefreshing(true)
            void Promise.resolve(onRefreshRef.current()).finally(() => {
                isRefreshingRef.current = false
                setIsRefreshing(false)
            })
        }

        const handleTouchStart = (event: TouchEvent) => {
            updatePullState('idle')
            pullStartY = container.scrollTop <= 0 && !isRefreshingRef.current
                ? event.touches[0]?.clientY ?? null
                : null
        }

        const handleTouchMove = (event: TouchEvent) => {
            if (pullStartY === null) {
                return
            }
            if (container.scrollTop > 0) {
                pullStartY = null
                updatePullState('idle')
                return
            }
            const currentY = event.touches[0]?.clientY
            if (currentY !== undefined) {
                updatePullState(getPullToRefreshState(currentY - pullStartY))
            }
        }

        const handleTouchEnd = () => {
            const shouldRefresh = pullStartY !== null
                && pullStateRef.current === 'ready'
                && container.scrollTop <= 0
            pullStartY = null
            updatePullState('idle')
            if (shouldRefresh) {
                triggerRefresh()
            }
        }

        const handleTouchCancel = () => {
            pullStartY = null
            updatePullState('idle')
        }

        container.addEventListener('touchstart', handleTouchStart, { passive: true })
        container.addEventListener('touchmove', handleTouchMove, { passive: true })
        container.addEventListener('touchend', handleTouchEnd, { passive: true })
        container.addEventListener('touchcancel', handleTouchCancel, { passive: true })
        return () => {
            container.removeEventListener('touchstart', handleTouchStart)
            container.removeEventListener('touchmove', handleTouchMove)
            container.removeEventListener('touchend', handleTouchEnd)
            container.removeEventListener('touchcancel', handleTouchCancel)
        }
    }, [])

    // #1717 off-viewport travel. Because the Blocked section keeps every
    // blocked row mounted at the top of the list, "make the row reachable"
    // only ever means expanding that section and dropping narrowing filters —
    // no directory-group expansion or preview-cap raising required.
    const jumpToNextBlocked = () => {
        if (blockedSessions.length === 0) return
        const renderedIds = new Set(machineFilteredSessions.map((session) => session.id))
        if (blockedSessions.some((session) => !renderedIds.has(session.id))) {
            // The pill counts blocked work the active filters hide. Travelling
            // without clearing them would skip rows the count promised.
            setSearchQuery('')
            setCustomStart('')
            setCustomEnd('')
            setMachineFilter(null)
            setShowUnreadOnly(false)
        }
        // A globally pinned blocked row lives in the Pinned section, not the
        // Blocked one — expand both or the jump lands on a zero-height row
        // inside a collapsed panel and appears to do nothing.
        setBlockedSectionCollapsed(false)
        setPinnedSectionCollapsed(false)
        const cursor = blockedJumpCursorRef.current % blockedSessions.length
        blockedJumpCursorRef.current = cursor + 1
        setPendingBlockedScrollId(blockedSessions[cursor]!.id)
    }

    useEffect(() => {
        if (!pendingBlockedScrollId) return
        const container = scrollContainerRef.current
        const row = container?.querySelector<HTMLElement>(
            `[data-session-id="${CSS.escape(pendingBlockedScrollId)}"]`
        )
        if (!row) {
            // Usually "not mounted yet": clearing a filter or expanding the
            // section re-renders and this effect runs again with the row in
            // place. If the session stopped being blocked meanwhile, drop the
            // request so it cannot wedge later jumps.
            if (!blockedSessions.some((session) => session.id === pendingBlockedScrollId)) {
                setPendingBlockedScrollId(null)
            }
            return
        }
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setFlashBlockedSessionId(pendingBlockedScrollId)
        setPendingBlockedScrollId(null)
    }, [pendingBlockedScrollId, blockedSessions, blockedSectionSessions, blockedSectionCollapsed, machineFilteredSessions])

    useEffect(() => {
        if (!flashBlockedSessionId) return
        const timer = setTimeout(() => setFlashBlockedSessionId(null), 2000)
        return () => clearTimeout(timer)
    }, [flashBlockedSessionId])

    // Direction hint for the pill: which way the operator would have to scroll
    // to reach blocked rows that are not currently on screen.
    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container || blockedCount === 0) {
            // Functional + bail-out. A fresh `{above:0,below:0}` here would be a
            // new identity every run, and this effect's deps churn on each
            // render (the `machineLabelsById = {}` prop default cascades
            // through the filter memos) — so an unconditional set becomes an
            // infinite render loop.
            setBlockedOffscreen((previous) => (
                previous.above === 0 && previous.below === 0
                    ? previous
                    : { above: 0, below: 0 }
            ))
            return
        }
        let frame = 0
        const measure = () => {
            frame = 0
            const bounds = container.getBoundingClientRect()
            const rows = container.querySelectorAll<HTMLElement>('[data-session-blocked]')
            let above = 0
            let below = 0
            rows.forEach((row) => {
                const rect = row.getBoundingClientRect()
                // A collapsed section keeps its rows in the DOM (the panel
                // animates `grid-template-rows: 0fr` rather than unmounting).
                // Read the panel's open state rather than the row's height:
                // the collapse is a 250ms transition, so a height check taken
                // on the frame the operator clicks still measures full-size
                // rows and would report them as visible.
                const panel = row.closest('.collapsible-panel')
                const inClosedPanel = panel !== null && !panel.hasAttribute('data-open')
                const onScreen = !inClosedPanel
                    && rect.height > 0
                    && rect.bottom > bounds.top
                    && rect.top < bounds.bottom
                if (onScreen) return
                if (rect.bottom <= bounds.top) above += 1
                else below += 1
            })
            // Rows an active filter excluded are not in the DOM at all. They
            // are not literally below the fold, but they are off-screen and
            // the pill's click reveals them — so they count toward "there is
            // more that way" rather than being dropped from the hint.
            const unmounted = Math.max(0, blockedCount - rows.length)
            const nextBelow = below + unmounted
            // Bail when nothing moved: this runs every scroll frame, and a
            // fresh object each time would re-render every row in the list.
            setBlockedOffscreen((previous) => (
                previous.above === above && previous.below === nextBelow
                    ? previous
                    : { above, below: nextBelow }
            ))
        }
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure)
        }
        schedule()
        container.addEventListener('scroll', schedule, { passive: true })
        window.addEventListener('resize', schedule)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            container.removeEventListener('scroll', schedule)
            window.removeEventListener('resize', schedule)
        }
    }, [blockedCount, blockedSectionSessions, blockedSectionCollapsed, machineFilteredSessions])

    const blockedDirection: BlockedJumpDirection = blockedOffscreen.above > 0 && blockedOffscreen.below > 0
        ? 'both'
        : blockedOffscreen.above > 0
            ? 'up'
            : blockedOffscreen.below > 0
                ? 'down'
                : 'none'

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="session-list-scrollbar-offset mx-auto w-full max-w-content shrink-0">
            {showHeaderRow ? (
                <div className="flex items-center gap-1 px-2 py-1">
                    {showSearch ? (
                        <SessionListSearch
                            value={searchQuery}
                            onChange={setSearchQuery}
                            customStart={customStart}
                            customEnd={customEnd}
                            sessionActivityDates={sessionActivityDates}
                            onDateRangeChange={(start, end) => {
                                setCustomStart(start)
                                setCustomEnd(end)
                            }}
                            expanded={searchExpanded}
                            onExpandedChange={setSearchExpanded}
                            api={api}
                        />
                    ) : null}
                    {!(showSearch && searchExpanded) ? (
                        <>
                            <div className="flex-1" />
                            {showMachineFilterBar ? (
                                <MachineFilterMenu
                                    machines={machineFilterItems}
                                    totalCount={allSessions.length}
                                    value={activeMachineFilter}
                                    onChange={setMachineFilter}
                                />
                            ) : null}
                            {blockedCount > 0 ? (
                                <>
                                    <BlockedJumpPill
                                        count={blockedCount}
                                        direction={blockedDirection}
                                        alerting={blockedAlerting}
                                        onJump={jumpToNextBlocked}
                                    />
                                    <BlockedLensToggle
                                        active={showBlockedOnly}
                                        count={blockedCount}
                                        onToggle={() => setShowBlockedOnly((value) => !value)}
                                    />
                                </>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                                aria-pressed={showUnreadOnly}
                                title={t('sessions.unreadFilter.toggle')}
                                aria-label={t('sessions.unreadFilter.toggle')}
                                className={cn(
                                    'flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                    showUnreadOnly
                                        ? 'bg-[var(--app-subtle-bg)]'
                                        : 'hover:bg-[var(--app-subtle-bg)]'
                                )}
                            >
                                {/* Same shape/color language as session-row unread dots (SessionAttentionIndicator). */}
                                <span
                                    aria-hidden
                                    className={cn(
                                        'inline-flex h-2.5 w-2.5 shrink-0 rounded-full',
                                        showUnreadOnly
                                            ? 'bg-[var(--app-link)]'
                                            : 'bg-[var(--app-hint)]'
                                    )}
                                />
                            </button>
                            <KitchenStatusChip api={api} />
                            {renderHeader ? (
                                <button
                                    type="button"
                                    onClick={props.onNewSession}
                                    className="session-list-new-button flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-link)] transition-colors"
                                    title={t('sessions.new')}
                                >
                                    <PlusIcon className="h-5 w-5" />
                                </button>
                            ) : null}
                            {props.headerActions}
                        </>
                    ) : null}
                </div>
            ) : null}

            {showMachineFilterBar ? (
                <MachineFilterBar
                    machines={machineFilterItems}
                    totalCount={allSessions.length}
                    value={activeMachineFilter}
                    onChange={setMachineFilter}
                />
            ) : null}
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
            {isRefreshing || pullState !== 'idle' || props.isLoading ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)]/90 px-2.5 py-1 text-xs text-[var(--app-hint)] shadow-sm backdrop-blur"
                >
                    {isRefreshing || props.isLoading
                        ? <Spinner size="sm" label={null} className="text-current" />
                        : <PullRefreshIcon rotation={getPullRefreshIndicatorRotation(pullState)} />}
                    <span>
                        {isRefreshing
                            ? t('sessions.refresh.refreshing')
                            : props.isLoading
                                ? t('misc.loading')
                                : pullState === 'ready'
                                    ? t('sessions.refresh.release')
                                    : t('sessions.refresh.pull')}
                    </span>
                </div>
            ) : null}
            <div ref={scrollContainerRef} className="app-scroll-y session-list-scrollbar-left min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-content flex-col gap-1 pl-1.5 pr-2 pb-2">
                {props.sessions.length === 0 && !props.isLoading ? (
                    <SessionsEmptyState
                        onNewSession={props.onNewSession}
                        onBrowse={props.onBrowse}
                    />
                ) : null}

                {props.sessions.length > 0 && (isFiltering || activeMachineFilter !== null || showUnreadOnly || showBlockedOnly) && groups.length === 0 && runningSessionTotal === 0 && activeSessionTotal === 0 && pinnedSessions.length === 0 && blockedSectionSessions.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                        {t('sessions.search.noResults')}
                    </div>
                ) : null}

                {pinnedSessions.length > 0 ? (
                    <div key="pinned-section">
                        <div
                            className="group/pinned flex min-w-0 w-full select-none cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                            role="button"
                            tabIndex={0}
                            aria-expanded={!pinnedSectionCollapsed || isFiltering}
                            onClick={() => setPinnedSectionCollapsed((value) => !value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setPinnedSectionCollapsed((value) => !value)
                                }
                            }}
                            title={t('sessions.pinnedSection')}
                        >
                            <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={pinnedSectionCollapsed && !isFiltering} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {t('sessions.pinnedSection')}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                                ({pinnedSessions.length})
                            </span>
                        </div>
                        <div className="collapsible-panel" data-open={(!pinnedSectionCollapsed || isFiltering) || undefined}>
                            <div className="collapsible-inner">
                                <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                                    {pinnedSessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            titleSuggestionAvailable={titleSuggestionAvailable}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                            inRunningSection
                                            projectLabel={getGroupDisplayName(resolveSessionGroupDirectory(s.metadata ?? {}))}
                                            machineLabel={resolveMachineLabel(s.metadata?.machineId ?? null)}
                                            lastSeenVersion={lastSeenVersion}
                                            flashHighlight={s.id === flashBlockedSessionId}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {blockedSectionSessions.length > 0 ? (
                    <div key="blocked-section" data-testid="blocked-section">
                        <div
                            className="group/blocked flex min-w-0 w-full select-none cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                            role="button"
                            tabIndex={0}
                            aria-expanded={!blockedSectionCollapsed || isFiltering}
                            onClick={() => setBlockedSectionCollapsed((value) => !value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setBlockedSectionCollapsed((value) => !value)
                                }
                            }}
                            title={t('sessions.blockedSection')}
                        >
                            <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={blockedSectionCollapsed && !isFiltering} />
                            <span className="inline-flex min-w-0 items-center gap-1 text-[var(--app-badge-warning-text)]">
                                <BlockedFlagIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 truncate text-sm font-medium">
                                    {t('sessions.blockedSection')}
                                </span>
                            </span>
                            <span className="min-w-0 flex-1" aria-hidden="true" />
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                                ({blockedSectionSessions.length})
                            </span>
                        </div>
                        <div className="collapsible-panel" data-open={(!blockedSectionCollapsed || isFiltering) || undefined}>
                            <div className="collapsible-inner">
                                <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                                    {blockedSectionSessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            titleSuggestionAvailable={titleSuggestionAvailable}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                            inRunningSection
                                            projectLabel={getGroupDisplayName(resolveSessionGroupDirectory(s.metadata ?? {}))}
                                            machineLabel={resolveMachineLabel(s.metadata?.machineId ?? null)}
                                            lastSeenVersion={lastSeenVersion}
                                            flashHighlight={s.id === flashBlockedSessionId}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {renderPinnedSection({
                    sectionKey: 'running-section',
                    titleKey: 'sessions.runningSection',
                    collapsed: runningSectionCollapsed,
                    onToggle: () => setRunningSectionCollapsed((value) => !value),
                    pulse: true,
                    count: runningSessionTotal,
                    bucketKeys: ['jobs', 'working', 'pending'],
                })}
                {renderPinnedSection({
                    sectionKey: 'active-section',
                    titleKey: 'sessions.activeSection',
                    collapsed: activeSectionCollapsed,
                    onToggle: () => setActiveSectionCollapsed((value) => !value),
                    pulse: false,
                    count: activeSessionTotal,
                    bucketKeys: ['active'],
                })}
                {groups.map(renderDirectoryGroup)}
                {actionOnlyGroups.map(renderActionOnlyGroupHeader)}
            </div>
            </div>
            </div>
        </div>
    )
}
