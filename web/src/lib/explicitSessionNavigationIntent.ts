// Module-level, not React state or context: the callers that need to mark
// intent (ToastContainer, markdown-text.tsx's SessionPathAnchor) are not
// descendants of the `/sessions` route component whose onBeforeNavigate
// subscriber needs to read it, so there is no shared tree position to host
// a ref or context value (Codex review, hapi#238, fourth finding on this
// navigation path).
//
// Exists because `isHistoryPopNavigation`'s index comparison (see its own
// doc comment in sessionsBoardsModeSync.ts) is a fallback heuristic, not a
// reliable push-vs-pop signal on its own: a fresh push right after a
// browser/device Back reuses that Back's own `__TSR_index` (pushes truncate
// forward history and start renumbering from the current entry's index, not
// from the global high-water mark), so a toast click or in-chat session
// link fired immediately after Back is indistinguishable, by index alone,
// from a genuine Back/Forward replay. Callers that know their own navigate()
// call represents an explicit, deliberate "go to this session" intent mark
// it here immediately before calling `navigate()`; the onBeforeNavigate
// subscriber consumes it once to override the index heuristic for that one
// event, regardless of what isHistoryPopNavigation concludes.
let explicitSessionNavigationIntent = false

export function markExplicitSessionNavigationIntent(): void {
    explicitSessionNavigationIntent = true
}

// Read-and-reset: must be consumed exactly once per onBeforeNavigate event,
// or a stale `true` would wrongly override an unrelated later navigation
// that never called mark().
export function consumeExplicitSessionNavigationIntent(): boolean {
    const value = explicitSessionNavigationIntent
    explicitSessionNavigationIntent = false
    return value
}
