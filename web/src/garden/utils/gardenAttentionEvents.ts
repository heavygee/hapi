export type AttentionReason = 'permission' | 'ready'

export type SessionAttentionSnapshot = {
    thinking: boolean
    pendingRequestKindsCount: number
}

export type AttentionRecord = {
    reason: AttentionReason
    /** Session updatedAt when attention was marked. */
    markedUpdatedAt: number
    /** Set when operator dwell-focuses this orb; used to detect post-focus state change. */
    focusBaselineUpdatedAt: number | null
}

export function sessionAttentionSnapshot(session: {
    thinking: boolean
    pendingRequestKinds: readonly string[]
}): SessionAttentionSnapshot {
    return {
        thinking: session.thinking,
        pendingRequestKindsCount: session.pendingRequestKinds.length,
    }
}

/** Returns attention reasons when session state crosses operator-relevant thresholds. */
export function detectAttentionEvents(
    prev: SessionAttentionSnapshot | undefined,
    next: SessionAttentionSnapshot,
): AttentionReason[] {
    if (!prev) {
        return []
    }

    const reasons: AttentionReason[] = []

    if (next.pendingRequestKindsCount > prev.pendingRequestKindsCount) {
        reasons.push('permission')
    }

    if (prev.thinking && !next.thinking) {
        reasons.push('ready')
    }

    return reasons
}

/** Ping any agent that is not the current voice-focus target. */
export function shouldPingSession(sessionId: string, focusedId: string | null): boolean {
    return focusedId !== sessionId
}

export function pickAttentionReason(reasons: AttentionReason[]): AttentionReason {
    if (reasons.includes('permission')) {
        return 'permission'
    }
    return 'ready'
}

/**
 * Clear sticky attention only after the operator has focused the orb and session state resolved.
 */
export function shouldClearAttention(
    record: AttentionRecord,
    session: { pendingRequestKinds: readonly string[]; updatedAt: number },
): boolean {
    if (record.focusBaselineUpdatedAt === null) {
        return false
    }

    if (record.reason === 'permission') {
        return session.pendingRequestKinds.length === 0
    }

    return session.updatedAt > record.focusBaselineUpdatedAt
}

export function createAttentionRecord(
    reason: AttentionReason,
    markedUpdatedAt: number,
): AttentionRecord {
    return {
        reason,
        markedUpdatedAt,
        focusBaselineUpdatedAt: null,
    }
}
