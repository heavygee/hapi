import {
    BLOCKED_NOTIFY_STALE_MS,
    isBlockedNotifyStatus,
    normalizeNotifyStatus
} from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'

export type SessionAttention =
    | { kind: 'permission' }
    | { kind: 'input' }
    | { kind: 'background' }
    | { kind: 'unread' }

/** True when the session has activity newer than the operator's last-seen watermark. */
export function sessionIsUnread(
    summary: SessionSummary,
    options: { lastSeenAt: number }
): boolean {
    return summary.updatedAt > options.lastSeenAt
}

export function classifySessionAttention(
    summary: SessionSummary,
    options: { selected: boolean; lastSeenAt: number; manualUnreadAt?: number | null }
): SessionAttention | null {
    if (options.selected) {
        return options.manualUnreadAt === summary.updatedAt
            ? { kind: 'unread' }
            : null
    }

    if (summary.thinking) {
        return null
    }

    const pendingRequestKinds = Array.isArray(summary.pendingRequestKinds)
        ? summary.pendingRequestKinds
        : []

    if (pendingRequestKinds.includes('permission')) {
        return { kind: 'permission' }
    }

    if (pendingRequestKinds.includes('input')) {
        return { kind: 'input' }
    }

    if (summary.active && (summary.backgroundTaskCount ?? 0) > 0) {
        return { kind: 'background' }
    }

    if (sessionIsUnread(summary, { lastSeenAt: options.lastSeenAt })) {
        return { kind: 'unread' }
    }

    return null
}

export function getSessionAttentionLabelKey(attention: SessionAttention): string {
    switch (attention.kind) {
        case 'permission':
            return 'session.item.permission'
        case 'input':
            return 'session.item.needsInput'
        case 'background':
            return 'session.item.background'
        case 'unread':
            return 'session.item.newActivity'
    }
}

/**
 * Blocked chrome for a session row — a *separate axis* from `SessionAttention`.
 *
 * `SessionAttention` describes a session that is live and waiting on a click
 * (permission / input) or merely unseen (unread). Blocked describes a turn that
 * *ended* with the agent reporting it cannot proceed. Both can be true at once,
 * so the list renders them in different visual channels (dot vs rail + chip)
 * rather than making one win a precedence fight.
 */
export type SessionBlockedState = {
    /** Normalized notify status (`blocked` | `stalled`). */
    status: string
    /** Epoch ms of the footer that reported it. */
    at: number
    note: string | null
    /** Past the loud window — render muted so abandoned rows stop alarming. */
    stale: boolean
}

export function getSessionBlockedState(
    summary: SessionSummary,
    options: { now: number }
): SessionBlockedState | null {
    const notify = summary.lastNotify
    if (!notify || !isBlockedNotifyStatus(notify.status)) {
        return null
    }

    // The agent is working again, so its last self-report no longer describes
    // the present. The hub clears `lastNotify` on the same transition, but the
    // list must not flash a stale rail in the window before that patch lands.
    if (summary.thinking) {
        return null
    }

    return {
        status: normalizeNotifyStatus(notify.status),
        at: notify.at,
        note: notify.note ?? null,
        stale: options.now - notify.at > BLOCKED_NOTIFY_STALE_MS
    }
}

export function sessionIsBlocked(summary: SessionSummary, options: { now: number }): boolean {
    return getSessionBlockedState(summary, options) !== null
}

export function getSessionBlockedLabelKey(state: SessionBlockedState): string {
    return state.status === 'stalled'
        ? 'session.summary.status.stalled'
        : 'session.summary.status.blocked'
}
