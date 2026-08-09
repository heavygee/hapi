import { createHash } from 'node:crypto'
import { constantTimeEquals } from './crypto'

/** sha256(runnerProof) for hub-persisted machine generation binding (#1473). */
export function hashRunnerProof(proof: string): string {
    return createHash('sha256').update(proof.trim(), 'utf8').digest('base64url')
}

export function verifyRunnerProof(proof: string, expectedHash: string | null | undefined): boolean {
    const presented = proof.trim()
    const expected = typeof expectedHash === 'string' ? expectedHash.trim() : ''
    if (!presented || !expected) {
        return false
    }
    return constantTimeEquals(hashRunnerProof(presented), expected)
}
