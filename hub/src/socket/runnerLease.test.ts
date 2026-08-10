import { describe, expect, it } from 'bun:test'
import { hashRunnerProof, verifyRunnerProof } from './runnerLease'

describe('runnerLease proof hash (#1473)', () => {
    it('verifies a matching proof against its hash', () => {
        const proof = 'runner-proof-secret'
        const hash = hashRunnerProof(proof)
        expect(verifyRunnerProof(proof, hash)).toBe(true)
        expect(verifyRunnerProof('other', hash)).toBe(false)
        expect(verifyRunnerProof(proof, null)).toBe(false)
        expect(verifyRunnerProof('', hash)).toBe(false)
    })
})
