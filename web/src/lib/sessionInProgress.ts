import type { SessionSummary } from '@hapi/protocol'

export function hasRunningAttachedJob(session: SessionSummary): boolean {
    return session.attachedJob?.status === 'running'
}

/**
 * Hub `thinking` that should show the Running spinner / bucket.
 * Ambient ACP chatter is filtered in the CLI (#1553); do not second-guess
 * `thinking` here when a long-running job is also attached — real prompts
 * still set thinking=true via prompt().
 */
export function isAgentForegroundThinking(session: SessionSummary): boolean {
    if (!session.active || !session.thinking) {
        return false
    }
    if ((session.backgroundTaskCount ?? 0) > 0) {
        return true
    }
    if ((session.pendingRequestsCount ?? 0) > 0) {
        return false
    }
    // No attached-job suppression here: the CLI filters ambient ACP chatter
    // (#1553), so a running job alongside thinking=true is a real agent turn.
    // The merge kept the soup's suppression under upstream's docstring, which
    // said the opposite, and hid genuinely-running sessions from Running.
    return true
}

/** Agent work that belongs in the In progress "Running" bucket (not Jobs). */
export function hasAgentForegroundWork(session: SessionSummary): boolean {
    if (!session.active) {
        return false
    }
    if ((session.backgroundTaskCount ?? 0) > 0) {
        return true
    }
    return isAgentForegroundThinking(session)
}
