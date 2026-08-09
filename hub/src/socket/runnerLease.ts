import { constantTimeEquals } from '../utils/crypto'

/**
 * Active runner-generation lease (#1473 Blocker).
 *
 * `machineTag` lives in shared settings (same-UID readable). Machine RPC /
 * resume mint delivery must require a memory-only proof that only the live
 * runner process holds. After disconnect, the proof sticks briefly so a
 * sibling cannot immediately invent a new proof and capture spawn-happy-session.
 */

export const RUNNER_LEASE_STALE_MS = 60_000

type RunnerLease = {
    proof: string
    socketId: string | null
    lastSeenAt: number
}

const leasesByMachineId = new Map<string, RunnerLease>()

export function tryClaimRunnerLease(opts: {
    machineId: string
    proof: string
    socketId: string
    nowMs?: number
    staleMs?: number
}): boolean {
    const now = opts.nowMs ?? Date.now()
    const staleMs = opts.staleMs ?? RUNNER_LEASE_STALE_MS
    const machineId = opts.machineId.trim()
    const proof = opts.proof.trim()
    const socketId = opts.socketId.trim()
    if (!machineId || !proof || !socketId) {
        return false
    }

    const current = leasesByMachineId.get(machineId)
    if (!current) {
        leasesByMachineId.set(machineId, { proof, socketId, lastSeenAt: now })
        return true
    }

    if (constantTimeEquals(current.proof, proof)) {
        current.socketId = socketId
        current.lastSeenAt = now
        return true
    }

    const holderGone = current.socketId === null
    const stale = now - current.lastSeenAt >= staleMs
    if (holderGone && stale) {
        leasesByMachineId.set(machineId, { proof, socketId, lastSeenAt: now })
        return true
    }

    return false
}

/** Clear live socket binding on disconnect; keep proof until stale for reclaim. */
export function releaseRunnerLeaseSocket(
    machineId: string,
    socketId: string,
    nowMs: number = Date.now()
): void {
    const id = machineId.trim()
    const current = leasesByMachineId.get(id)
    if (!current || current.socketId !== socketId.trim()) {
        return
    }
    current.socketId = null
    current.lastSeenAt = nowMs
}

/** Explicit release (matching proof) — allows immediate reclaim after clean stop. */
export function releaseRunnerLease(machineId: string, proof: string): boolean {
    const id = machineId.trim()
    const presented = proof.trim()
    const current = leasesByMachineId.get(id)
    if (!current || !presented || !constantTimeEquals(current.proof, presented)) {
        return false
    }
    leasesByMachineId.delete(id)
    return true
}

export function clearRunnerLeasesForTests(): void {
    leasesByMachineId.clear()
}
