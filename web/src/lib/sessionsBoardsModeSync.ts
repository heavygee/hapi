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

/**
 * Whether a navigation is purely a `boardItem` search-param transition —
 * selecting/closing/switching a board item's detail view while Boards mode
 * overlays an existing session route — and so must be exempted from
 * `shouldExitBoardsModeForNavigation` above (Codex review, hapi#238: once
 * `boardItem` became real router search state, selecting an item while
 * Boards was layered over `/sessions/:id` called `navigate({ to: '.' })`,
 * whose destination pathname is unchanged — exactly what
 * `shouldExitBoardsModeForNavigation` treats as session-targeting, so it
 * immediately kicked back out to Sessions mode the instant an item was
 * selected).
 *
 * `pathChanged` must be false — a *genuine* navigation to the same pathname
 * (the toast/sidebar-re-target case the function above exists for) must
 * still exit Boards mode, and critically that case has `boardItem` absent
 * from search on *both* sides, so checking "does either side have
 * `boardItem` set" alone correctly leaves it unexempted. Checking either
 * side (not just one) is what makes this symmetric across every direction
 * the transition can run: selecting an item for the first time only sets it
 * on `to`; the detail pane's own Back button or genuine browser/device Back
 * popping through that same history entry only has it on `from`; switching
 * directly between two items' details has it on both.
 *
 * IMPORTANT (Codex review, hapi#238, third finding on this path): this
 * predicate alone is NOT enough to decide the exemption — it must only be
 * consulted for navigations that `isHistoryPopNavigation` identifies as
 * replaying existing browser history (device/browser Back or Forward). A
 * toast or in-chat session link that happens to target the *same* session
 * Boards is already overlaying with an item selected is event-shape-identical
 * to closing that item via Back (same pathname, `boardItem` only on the
 * origin) — but it's a *fresh* `navigate()` push, not a history replay, and
 * must still exit Boards mode to surface that session's chat. Pure
 * before/after location-diffing can't tell these two apart; only the
 * underlying history action (push vs. pop) can. See `isHistoryPopNavigation`.
 */
export function isBoardItemDetailNavigation(
    pathChanged: boolean,
    fromSearch: { boardItem?: unknown },
    toSearch: { boardItem?: unknown }
): boolean {
    if (pathChanged) return false
    return typeof fromSearch.boardItem === 'string' || typeof toSearch.boardItem === 'string'
}

/**
 * Whether a navigation *looks like* it is replaying an already-existing
 * browser history entry (device/browser Back or Forward) rather than
 * pushing a brand-new one. This is a fallback heuristic, not a reliable
 * signal on its own — see the correction below — and callers should prefer
 * `explicitSessionNavigationIntent.ts` wherever the navigating code knows
 * its own intent.
 *
 * TanStack Router stamps every history entry with a `__TSR_index`, but it is
 * *not* globally monotonically increasing the way an earlier version of this
 * comment claimed (confirmed by reading `@tanstack/router-core`'s compiled
 * source, not assumed): a fresh push's index is `(current location's own
 * stamped index) + 1`. Pushing after a Back therefore reuses whatever index
 * the Back landed on, plus one — which can easily equal an index this
 * function has already seen from a *different*, now-truncated forward
 * branch. Concretely: select card X (index 1), select card Y (index 2),
 * press Back to X (lands back on index 1, `maxIndexSeen` stays 2), then
 * click a toast or in-chat link targeting session A — that fresh push lands
 * at index 2 (1 + 1), identical to Y's now-truncated index, and this
 * function wrongly reports it as a pop. No reload required; this is not the
 * narrow reload-only gap a previous version of this comment described.
 *
 * Callers must track `maxIndexSeen` across navigations themselves (it is not
 * global router state) and update it to `Math.max(maxIndexSeen, toIndex)`
 * after each call, regardless of the result — seeded from the current entry's
 * own index at mount (not a hardcoded 0), so a page reloaded mid-session
 * already knows its real starting position.
 *
 * Because index comparison alone cannot distinguish these cases, the actual
 * fix is `explicitSessionNavigationIntent.ts`: call sites that know their
 * `navigate()` call is a genuine "go to this session" action (ToastContainer,
 * markdown-text.tsx's SessionPathAnchor) mark that intent immediately before
 * navigating, and the `onBeforeNavigate` subscriber in router.tsx consumes it
 * to override whatever this function concludes for that one event. This
 * function remains the fallback for navigations that don't (or can't) mark
 * intent — e.g. an actual browser/device Back/Forward, which by definition
 * never calls `markExplicitSessionNavigationIntent()`.
 */
export function isHistoryPopNavigation(toIndex: number, maxIndexSeen: number): boolean {
    return toIndex <= maxIndexSeen
}
