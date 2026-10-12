import { describe, expect, it } from 'vitest'
import { isAbandoningSpawnFlow } from './spawnFlowAbandonment'

describe('isAbandoningSpawnFlow', () => {
    it('is false while staying on the same leg (e.g. a search-param-only change)', () => {
        expect(isAbandoningSpawnFlow('/sessions/new', '/sessions/new')).toBe(false)
        expect(isAbandoningSpawnFlow('/browse', '/browse')).toBe(false)
    })

    it('is false when crossing between the two legs of the same deliberate round trip', () => {
        expect(isAbandoningSpawnFlow('/sessions/new', '/browse')).toBe(false)
        expect(isAbandoningSpawnFlow('/browse', '/sessions/new')).toBe(false)
    })

    it('is true for any other destination, including browser-history-driven navigation', () => {
        expect(isAbandoningSpawnFlow('/sessions/new', '/sessions')).toBe(true)
        expect(isAbandoningSpawnFlow('/sessions/new', '/sessions/some-id')).toBe(true)
        expect(isAbandoningSpawnFlow('/browse', '/sessions')).toBe(true)
        expect(isAbandoningSpawnFlow('/browse', '/sessions/some-id')).toBe(true)
        expect(isAbandoningSpawnFlow('/sessions/new', '/settings')).toBe(true)
    })
})
