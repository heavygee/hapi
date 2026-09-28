/**
 * Decide whether a Claude `sessionFound` id should update durable metadata.
 *
 * When HAPI asked Claude to `--resume A` and Claude reports B≠A without an
 * explicit fork, overwriting `metadata.claudeSessionId` burns the last good
 * resume pointer (tiann/hapi#1933). Keep A and treat the mismatch as failure.
 */

export type ClaudeSessionFoundDecision =
    | { action: 'accept'; sessionId: string; extras?: { forkedFrom: string } }
    | {
        action: 'reject'
        requestedId: string
        reportedId: string
        reason: 'resume_mismatch'
    }

export function decideClaudeSessionFound(opts: {
    requestedId: string | null | undefined
    reportedId: string
    forkRequested?: boolean
}): ClaudeSessionFoundDecision {
    const requested = typeof opts.requestedId === 'string' && opts.requestedId.trim().length > 0
        ? opts.requestedId.trim()
        : null
    const reported = opts.reportedId.trim()
    if (!reported) {
        // Defensive: callers should not pass empty ids. Reject if we were
        // trying to resume; otherwise accept is impossible without a value.
        if (requested) {
            return {
                action: 'reject',
                requestedId: requested,
                reportedId: reported,
                reason: 'resume_mismatch'
            }
        }
        return { action: 'accept', sessionId: reported }
    }

    if (!requested || requested === reported) {
        return { action: 'accept', sessionId: reported }
    }

    if (opts.forkRequested) {
        return {
            action: 'accept',
            sessionId: reported,
            extras: { forkedFrom: requested }
        }
    }

    return {
        action: 'reject',
        requestedId: requested,
        reportedId: reported,
        reason: 'resume_mismatch'
    }
}
