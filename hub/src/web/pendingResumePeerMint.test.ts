import { beforeEach, describe, expect, it } from 'bun:test'
import {
    armResumePeerMint,
    clearResumePeerMint,
    clearResumePeerMintsForTests,
    consumeResumePeerMint,
    redeemResumePeerMint,
} from './pendingResumePeerMint'

describe('pendingResumePeerMint', () => {
    beforeEach(() => {
        clearResumePeerMintsForTests()
    })

    it('redeems only with the matching nonce (not first-connector)', () => {
        const nonce = armResumePeerMint('session-a', 1_000, 30_000)
        expect(nonce).toBeTruthy()
        expect(consumeResumePeerMint('session-a', 1_001)).toBe(false)
        expect(redeemResumePeerMint('session-a', 'wrong', 1_001)).toBe(false)
        expect(redeemResumePeerMint('session-a', nonce, 1_001)).toBe(true)
        expect(redeemResumePeerMint('session-a', nonce, 1_002)).toBe(false)
    })

    it('clears on explicit disarm (spawn failure)', () => {
        const nonce = armResumePeerMint('session-a', 1_000, 30_000)
        clearResumePeerMint('session-a')
        expect(redeemResumePeerMint('session-a', nonce, 1_001)).toBe(false)
    })

    it('rejects expired mints', () => {
        const nonce = armResumePeerMint('session-a', 1_000, 30_000)
        expect(redeemResumePeerMint('session-a', nonce, 1_000 + 30_001)).toBe(false)
    })

    it('keeps the first unexpired nonce across concurrent arms', () => {
        const first = armResumePeerMint('session-a', 1_000, 30_000)
        const second = armResumePeerMint('session-a', 1_500, 30_000)
        expect(second).toBe(first)
        expect(redeemResumePeerMint('session-a', first, 1_600)).toBe(true)
    })
})
