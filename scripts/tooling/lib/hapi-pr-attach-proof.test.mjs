import { describe, expect, test } from 'bun:test'
import { parsePrSpec } from './hapi-pr-attach-proof.mjs'

describe('hapi-pr-attach-proof shim', () => {
    test('re-exports parsePrSpec from estate skill', () => {
        expect(parsePrSpec('heavygee/hapi#1').nameWithOwner).toBe('heavygee/hapi')
    })
})
