import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { getTodoProgress } from './sessionRowHelpers'

function session(partial: Partial<SessionSummary> & Pick<SessionSummary, 'id'>): SessionSummary {
    return {
        active: false,
        updatedAt: Date.now(),
        metadata: null,
        pendingRequestsCount: 0,
        futureScheduledMessageCount: 0,
        ...partial,
    } as SessionSummary
}

describe('getTodoProgress', () => {
    it('returns null when missing or complete', () => {
        expect(getTodoProgress(session({ id: 'a' }))).toBeNull()
        expect(getTodoProgress(session({
            id: 'b',
            todoProgress: { completed: 2, total: 2 },
        }))).toBeNull()
    })

    it('returns incomplete progress', () => {
        expect(getTodoProgress(session({
            id: 'c',
            todoProgress: { completed: 1, total: 3 },
        }))).toEqual({ completed: 1, total: 3 })
    })
})
