import { describe, expect, it } from 'bun:test'
import { mintPeerSessionCapability, verifyPeerSessionCapability } from './peerCapability'

const SECRET = new TextEncoder().encode('unit-test-jwt-secret')

describe('peer session capability', () => {
    it('mints a stable capability bound to one session id', () => {
        const sessionId = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        const a = mintPeerSessionCapability(sessionId, SECRET)
        const b = mintPeerSessionCapability(sessionId, SECRET)
        expect(a).toBe(b)
        expect(verifyPeerSessionCapability(sessionId, a, SECRET)).toBe(true)
    })

    it('rejects a capability minted for a different session', () => {
        const sourceA = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        const sourceB = '05d9f0f2-9273-4137-933c-07459a1146a2'
        const capA = mintPeerSessionCapability(sourceA, SECRET)
        expect(verifyPeerSessionCapability(sourceB, capA, SECRET)).toBe(false)
        expect(verifyPeerSessionCapability(sourceA, 'forged', SECRET)).toBe(false)
        expect(verifyPeerSessionCapability(sourceA, undefined, SECRET)).toBe(false)
    })
})
