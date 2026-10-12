import { describe, expect, it } from 'vitest'
import { shouldExitTodoModeForNavigation } from './sessionsTodoModeSync'

describe('shouldExitTodoModeForNavigation', () => {
    it('exits To-Do mode on navigation to a session route, even the one already shown by the URL', () => {
        // Regression (hapi#238 Codex review): a toast/sidebar click that
        // re-targets the session the URL already points to (because mode
        // switching never touches the URL) must still surface it — an
        // id-equality check can't see this navigation at all.
        expect(shouldExitTodoModeForNavigation('/sessions/session-1', 'todo')).toBe(true)
    })

    it('exits To-Do mode on navigation to a different session', () => {
        expect(shouldExitTodoModeForNavigation('/sessions/session-2', 'todo')).toBe(true)
    })

    it('does NOT exit To-Do mode for a new-session route', () => {
        expect(shouldExitTodoModeForNavigation('/sessions/new', 'todo')).toBe(false)
    })

    it('does NOT exit To-Do mode for a non-session route', () => {
        expect(shouldExitTodoModeForNavigation('/browse', 'todo')).toBe(false)
        expect(shouldExitTodoModeForNavigation('/sessions', 'todo')).toBe(false)
    })

    it('does nothing while already in Sessions mode', () => {
        expect(shouldExitTodoModeForNavigation('/sessions/session-1', 'sessions')).toBe(false)
    })
})
