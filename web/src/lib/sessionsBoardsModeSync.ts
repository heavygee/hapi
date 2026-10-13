import type { SessionsMode } from '@/components/SessionsModeSwitch'

// Matches /sessions/:id and every nested descendant (/files, /terminal,
// /file, ...) — not just the bare detail route (Codex review, hapi#238: the
// one-segment-only version missed browser history landing on a nested route
// like /sessions/A/files while Boards mode was active, leaving the stale
// board item detail rendered over the outlet instead of exiting Boards mode).
const SESSION_ROUTE = /^\/sessions\/([^/]+)(\/.*)?$/

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
 * `/sessions/new` is NOT excluded (Codex review, hapi#238): it used to be,
 * on the theory that composing a new session was never routed through
 * "exit Boards" — true for the board-spawn flow itself, which already
 * resets both `sessionsMode` and the selected item explicitly before it
 * ever calls `navigate()` (`handleSpawnFromBoardItem`), so it never relied
 * on this function for that. But any OTHER way of reaching `/sessions/new`
 * while Boards mode is active with an item selected — browser Forward/Back
 * being the obvious one — left both pieces of state untouched, and the
 * right pane keeps rendering the stale selected item's detail instead of
 * `<Outlet/>` (hiding the new-session form entirely on mobile, where only
 * one pane shows at a time). Exiting Boards mode for `/sessions/new` too,
 * same as any other session-targeting route, fixes that without changing
 * anything about the board-spawn flow's own already-explicit reset.
 */
export function shouldExitBoardsModeForNavigation(pathname: string, sessionsMode: SessionsMode): boolean {
    if (sessionsMode !== 'boards') return false
    return SESSION_ROUTE.test(pathname)
}
