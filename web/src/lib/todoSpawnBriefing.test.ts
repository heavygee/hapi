import { afterEach, describe, expect, it } from 'vitest'
import { clearTodoSpawnBriefing, peekTodoSpawnBriefing, stashTodoSpawnBriefing } from './todoSpawnBriefing'

afterEach(() => {
    sessionStorage.clear()
})

describe('todoSpawnBriefing', () => {
    it('round-trips a stashed briefing by its opaque id', () => {
        const id = stashTodoSpawnBriefing({ initialMessage: 'Fix the thing', linkIssueUrl: 'https://github.com/heavygee/hapi/issues/235' })
        expect(peekTodoSpawnBriefing(id)).toEqual({ initialMessage: 'Fix the thing', linkIssueUrl: 'https://github.com/heavygee/hapi/issues/235' })
    })

    it('does not delete on peek — the same id can be read again (survives a /browse round trip)', () => {
        const id = stashTodoSpawnBriefing({ initialMessage: 'Fix the thing' })
        peekTodoSpawnBriefing(id)
        expect(peekTodoSpawnBriefing(id)).toEqual({ initialMessage: 'Fix the thing', linkIssueUrl: undefined })
    })

    it('clears the entry so it is no longer readable afterward', () => {
        const id = stashTodoSpawnBriefing({ initialMessage: 'Fix the thing' })
        clearTodoSpawnBriefing(id)
        expect(peekTodoSpawnBriefing(id)).toBeNull()
    })

    it('returns null for an unknown id', () => {
        expect(peekTodoSpawnBriefing('not-a-real-id')).toBeNull()
    })
})
