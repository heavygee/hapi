import type { SessionsMode } from '@/components/SessionsModeSwitch'

const SESSION_ROUTE = /^\/sessions\/([^/]+)\/?$/

/**
 * Decides whether an actual router navigation (not a mode-switch click)
 * should exit To-Do mode back to Sessions.
 *
 * Driven by the navigation event itself (the router's `onBeforeNavigate`,
 * which fires for every `navigate()` call regardless of whether the
 * resulting location differs from the current one) rather than by comparing
 * before/after selected-session ids. That distinction matters: switching to
 * To-Do mode never touches the URL, so the common case of opening a chat and
 * then clicking To-Do leaves the route's session id unchanged — an
 * id-equality check alone can't tell that apart from a toast/sidebar click
 * that re-targets the *same* session while already in To-Do mode (which
 * must still surface that session, even though nothing about the id
 * changes). Reacting to the navigation event itself handles both: a mode
 * switch never calls `navigate()` at all, so it's never seen here, while any
 * session-targeting `navigate()` call is (hapi#238 Codex review — two prior
 * passes on the id-equality version: the first reset on "a session is
 * selected" alone and broke opening To-Do from a selected-session route; the
 * second case still couldn't distinguish "navigated to session A" from
 * "already showing session A, navigated to session A again").
 *
 * `/sessions/new` is deliberately excluded — composing a new session was
 * never routed through "exit To-Do", and nothing about this fix changes
 * that scope.
 */
export function shouldExitTodoModeForNavigation(pathname: string, sessionsMode: SessionsMode): boolean {
    if (sessionsMode !== 'todo') return false
    const match = SESSION_ROUTE.exec(pathname)
    if (!match) return false
    return match[1] !== 'new'
}
