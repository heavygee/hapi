import { describe, expect, it } from 'vitest'
import { shouldExitBoardsModeForNavigation } from './sessionsBoardsModeSync'

describe('shouldExitBoardsModeForNavigation', () => {
    it('exits To-Do mode on navigation to a session route, even the one already shown by the URL', () => {
        // Regression (hapi#238 Codex review): a toast/sidebar click that
        // re-targets the session the URL already points to (because mode
        // switching never touches the URL) must still surface it — an
        // id-equality check can't see this navigation at all.
        expect(shouldExitBoardsModeForNavigation('/sessions/session-1', 'boards')).toBe(true)
    })

    it('exits To-Do mode on navigation to a different session', () => {
        expect(shouldExitBoardsModeForNavigation('/sessions/session-2', 'boards')).toBe(true)
    })

    it('exits Boards mode for a new-session route too (Codex review)', () => {
        // Regression: this used to be excluded on the theory that composing
        // a new session was never routed through "exit Boards" — true only
        // for the board-spawn flow itself, which already resets both
        // sessionsMode and the selected item explicitly before it ever
        // navigates. Any OTHER way of reaching /sessions/new while Boards
        // mode is active with an item selected (browser Forward/Back being
        // the obvious one) left both untouched, so the right pane kept
        // rendering the stale selected item's detail instead of <Outlet/>
        // — hiding the new-session form entirely on mobile.
        expect(shouldExitBoardsModeForNavigation('/sessions/new', 'boards')).toBe(true)
    })

    it('does NOT exit To-Do mode for a non-session route', () => {
        expect(shouldExitBoardsModeForNavigation('/browse', 'boards')).toBe(false)
        expect(shouldExitBoardsModeForNavigation('/sessions', 'boards')).toBe(false)
    })

    it('does nothing while already in Sessions mode', () => {
        expect(shouldExitBoardsModeForNavigation('/sessions/session-1', 'sessions')).toBe(false)
    })
})
