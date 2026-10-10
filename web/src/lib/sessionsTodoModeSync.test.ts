import { describe, expect, it } from 'vitest'
import { shouldExitTodoModeForSession } from './sessionsTodoModeSync'

describe('shouldExitTodoModeForSession', () => {
    it('does NOT exit To-Do mode when a session was already selected and the user just switched modes', () => {
        // Regression (hapi#238 Codex review, P1): a prior fix reset on
        // "a session is selected" alone, which made it impossible to ever
        // open To-Do mode while on a /sessions/:id route — the common case.
        expect(shouldExitTodoModeForSession('session-1', 'session-1', 'todo')).toBe(false)
    })

    it('exits To-Do mode when navigation selects a new session while in To-Do mode', () => {
        expect(shouldExitTodoModeForSession(null, 'session-1', 'todo')).toBe(true)
        expect(shouldExitTodoModeForSession('session-1', 'session-2', 'todo')).toBe(true)
    })

    it('does nothing while already in Sessions mode', () => {
        expect(shouldExitTodoModeForSession(null, 'session-1', 'sessions')).toBe(false)
    })

    it('does nothing when the selected session changes to null (deselected)', () => {
        expect(shouldExitTodoModeForSession('session-1', null, 'todo')).toBe(false)
    })

    it('does nothing when nothing changed and no session is selected', () => {
        expect(shouldExitTodoModeForSession(null, null, 'todo')).toBe(false)
    })
})
