import type { SessionsMode } from '@/components/SessionsModeSwitch'

/**
 * Decides whether a session-route navigation should exit To-Do mode.
 *
 * Gated on the selected session id actually CHANGING, not merely being
 * non-null: mode switching never touches the URL, so the normal case of
 * opening a chat and then clicking To-Do leaves `selectedSessionId`
 * non-null — resetting on that alone would make To-Do mode impossible to
 * open from any selected-session route. Only a genuine navigation to a
 * *different* (or newly-selected) session should force Sessions mode back
 * on — a toast click, browser back/forward, anything other than the
 * explicit to-do-spawn flow, which already resets synchronously before
 * navigating (hapi#238 Codex review, two passes — the first fix reset on
 * "session selected" alone and broke opening To-Do from a selected session).
 */
export function shouldExitTodoModeForSession(
    previousSelectedSessionId: string | null,
    selectedSessionId: string | null,
    sessionsMode: SessionsMode
): boolean {
    const changed = previousSelectedSessionId !== selectedSessionId
    return changed && selectedSessionId !== null && sessionsMode !== 'sessions'
}
