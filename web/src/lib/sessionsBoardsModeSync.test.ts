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

    it('does NOT exit To-Do mode for a new-session route', () => {
        expect(shouldExitBoardsModeForNavigation('/sessions/new', 'boards')).toBe(false)
    })

    it('does NOT exit To-Do mode for a non-session route', () => {
        expect(shouldExitBoardsModeForNavigation('/browse', 'boards')).toBe(false)
        expect(shouldExitBoardsModeForNavigation('/sessions', 'boards')).toBe(false)
    })

    it('does nothing while already in Sessions mode', () => {
        expect(shouldExitBoardsModeForNavigation('/sessions/session-1', 'sessions')).toBe(false)
    })
})
