import { beforeEach, describe, expect, it } from 'bun:test'
import {
    armResumePeerMint,
    clearResumePeerMintsForTests,
    consumeResumePeerMint,
} from './pendingResumePeerMint'

describe('pendingResumePeerMint', () => {
    beforeEach(() => {
        clearResumePeerMintsForTests()
    })

    it('arms a one-shot mint that is consumed on first use', () => {
        armResumePeerMint('session-a', 1_000, 30_000)
        expect(consumeResumePeerMint('session-a', 1_001)).toBe(true)
        expect(consumeResumePeerMint('session-a', 1_002)).toBe(false)
    })

    it('rejects expired mints', () => {
        armResumePeerMint('session-a', 1_000, 30_000)
        expect(consumeResumePeerMint('session-a', 1_000 + 30_001)).toBe(false)
    })

    it('does not mint for sessions that were never armed', () => {
        expect(consumeResumePeerMint('nope')).toBe(false)
    })
})
