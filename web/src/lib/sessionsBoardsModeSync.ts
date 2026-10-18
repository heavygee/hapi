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
 * Whether a navigation is replaying an already-existing browser history entry
 * (device/browser Back or Forward) rather than pushing a brand-new one (a
 * fresh `navigate()` call from app code — selecting a board item, a toast
 * click, an in-chat session link, ...).
 *
 * TanStack Router stamps every history entry with a monotonically increasing
 * `__TSR_index` at push time; Back/Forward can only ever land on an index
 * that was already stamped by some earlier push, while a brand-new push
 * always gets a fresh index one higher than any seen so far (`REPLACE`
 * keeps the current index, which also counts as "already seen"). Comparing
 * the destination's index against the highest index observed so far is
 * therefore a reliable push-vs-pop signal that plain before/after location
 * diffing (`isBoardItemDetailNavigation` above) cannot provide on its own —
 * two structurally identical transitions (same pathname, `boardItem` only on
 * the origin) can be either a genuine Back-through-history or an unrelated
 * fresh push to a route that happens to look the same, and only the index
 * relationship distinguishes them (Codex review, hapi#238).
 *
 * Callers must track `maxIndexSeen` across navigations themselves (it is not
 * global router state) and update it to `Math.max(maxIndexSeen, toIndex)`
 * after each call, regardless of the result — seeded from the current entry's
 * own index at mount (not a hardcoded 0), so a page reloaded mid-session
 * already knows its real starting position.
 *
 * Known accepted gap (Codex review, hapi#238, investigated in depth — not an
 * oversight): a page *reload* only resets what this ref has personally
 * observed, not the browser's actual history stack. If, before the reload,
 * the user had selected an item (pushing a higher index) and then gone Back,
 * a Forward *after* the reload lands on that pre-existing higher index —
 * which this ref has never seen since remounting — and gets misread as a
 * fresh push. Seeding from `window.history.length` instead was considered
 * and rejected: a genuine fresh push always lands at exactly
 * `currentIndex + 1` regardless of how much (now-truncated) forward history
 * used to exist beyond it, so that seed can just as easily misclassify an
 * unrelated fresh push (a toast click, an in-chat link) as a pop — trading
 * one bug for another, not fixing it. The one signal that *would* resolve
 * this unambiguously — TanStack Router's own internal `HistoryAction` per
 * commit — is recorded in `@tanstack/router-core`'s `locationHistoryActions`
 * WeakMap, but that symbol isn't part of the package's public `exports` map
 * (confirmed: a subpath import throws at resolution, not just at the type
 * level) and the package's public events give no other way to correlate the
 * real action with the specific `onBeforeNavigate` event that needs it
 * (`router.history.subscribe` and raw `popstate` both fire for the *same*
 * commit, but strictly *after* `onBeforeNavigate` has already run for it,
 * since TanStack's own internal history subscriber — the one that actually
 * computes and emits `onBeforeNavigate` — is always registered first). Given
 * no accessible ground truth and no index-only heuristic that doesn't just
 * relocate the ambiguity, this narrow sequence (select → Back → reload →
 * Forward) is an accepted limitation rather than something to keep patching.
 */
export function isHistoryPopNavigation(toIndex: number, maxIndexSeen: number): boolean {
    return toIndex <= maxIndexSeen
}
