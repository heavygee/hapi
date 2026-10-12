import { describe, expect, it } from 'vitest'
import { isAbandoningSpawnFlow } from './spawnFlowAbandonment'

describe('isAbandoningSpawnFlow', () => {
    it('is false while staying on /sessions/new (e.g. a search-param-only change)', () => {
        expect(isAbandoningSpawnFlow('/sessions/new')).toBe(false)
    })

    it('is false when detouring through /browse — a deliberate continuation, not an abandonment', () => {
        expect(isAbandoningSpawnFlow('/browse')).toBe(false)
    })

    it('is true for any other destination, including browser-history-driven navigation', () => {
        expect(isAbandoningSpawnFlow('/sessions')).toBe(true)
        expect(isAbandoningSpawnFlow('/sessions/some-id')).toBe(true)
        expect(isAbandoningSpawnFlow('/settings')).toBe(true)
    })
})
