import { beforeEach, describe, expect, it } from 'bun:test'
import {
    clearRunnerLeasesForTests,
    releaseRunnerLease,
    releaseRunnerLeaseSocket,
    RUNNER_LEASE_STALE_MS,
    tryClaimRunnerLease,
} from './runnerLease'

describe('runnerLease (#1473)', () => {
    beforeEach(() => {
        clearRunnerLeasesForTests()
    })

    it('grants the first proof and rejects a sibling inventing another proof while live', () => {
        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a',
            nowMs: 1_000,
        })).toBe(true)

        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-b',
            socketId: 'sock-b',
            nowMs: 1_100,
        })).toBe(false)
    })

    it('allows the same proof to reclaim across reconnect', () => {
        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a',
            nowMs: 1_000,
        })).toBe(true)

        releaseRunnerLeaseSocket('m1', 'sock-a', 1_500)

        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a2',
            nowMs: 1_600,
        })).toBe(true)
    })

    it('rejects a new proof immediately after disconnect (sticky window)', () => {
        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a',
            nowMs: 1_000,
        })).toBe(true)

        releaseRunnerLeaseSocket('m1', 'sock-a', 2_000)

        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-sibling',
            socketId: 'sock-evil',
            nowMs: 2_100,
        })).toBe(false)
    })

    it('allows a new proof after the lease goes stale', () => {
        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a',
            nowMs: 1_000,
        })).toBe(true)

        releaseRunnerLeaseSocket('m1', 'sock-a', 2_000)

        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-new',
            socketId: 'sock-new',
            nowMs: 2_000 + RUNNER_LEASE_STALE_MS,
        })).toBe(true)
    })

    it('allows immediate reclaim after explicit proof release', () => {
        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-a',
            socketId: 'sock-a',
            nowMs: 1_000,
        })).toBe(true)

        expect(releaseRunnerLease('m1', 'proof-a')).toBe(true)

        expect(tryClaimRunnerLease({
            machineId: 'm1',
            proof: 'proof-new',
            socketId: 'sock-new',
            nowMs: 1_100,
        })).toBe(true)
    })
})
