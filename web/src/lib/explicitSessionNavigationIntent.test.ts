import { describe, expect, it } from 'vitest'
import { consumeExplicitSessionNavigationIntent, markExplicitSessionNavigationIntent } from './explicitSessionNavigationIntent'

describe('explicitSessionNavigationIntent', () => {
    it('starts unset', () => {
        expect(consumeExplicitSessionNavigationIntent()).toBe(false)
    })

    it('reports true once after marking, then resets', () => {
        markExplicitSessionNavigationIntent()
        expect(consumeExplicitSessionNavigationIntent()).toBe(true)
        expect(consumeExplicitSessionNavigationIntent()).toBe(false)
    })
})
