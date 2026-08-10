import { describe, expect, it } from 'bun:test'
import { Store } from './index'
import { MachineTagConflictError, mergeMachineMetadata } from './machines'
import { hashRunnerProof } from '../utils/runnerProof'

describe('machine tag enrollment (#1473)', () => {
    it('binds runnerProofHash on create and refuses null-hash first-claim', () => {
        const store = new Store(':memory:')
        const first = store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'h' },
            null,
            'ns',
            'secret-tag',
            'proof-a'
        )
        expect(first.runnerProofHash).toBe(hashRunnerProof('proof-a'))
        expect(() => store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'h2' },
            null,
            'ns',
            'secret-tag',
            'proof-b'
        )).toThrow(MachineTagConflictError)

        const unbound = store.machines.getOrCreateMachine(
            'machine-unbound',
            { host: 'h' },
            null,
            'ns',
            'secret-tag'
        )
        expect(unbound.runnerProofHash).toBeNull()
        expect(() => store.machines.getOrCreateMachine(
            'machine-unbound',
            { host: 'h' },
            null,
            'ns',
            'secret-tag',
            'proof-late'
        )).toThrow(/runner proof missing/)

        // Bound rows reject omitted proof (#1473 Major) — must not refresh metadata.
        expect(() => store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'hijack' },
            null,
            'ns',
            'secret-tag'
        )).toThrow(/runner proof mismatch/)
        expect(store.machines.getMachine('machine-proof')?.metadata).toEqual({ host: 'h' })
        store.close()
    })

    it('refuses first-claim bind on legacy untagged rows', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine('machine-1', { host: 'old' }, null, 'ns')
        expect(store.machines.getMachine('machine-1')?.tag).toBeNull()

        expect(() =>
            store.machines.getOrCreateMachine('machine-1', { host: 'old' }, null, 'ns', 'attacker-tag')
        ).toThrow(MachineTagConflictError)

        expect(store.machines.getMachine('machine-1')?.tag).toBeNull()
    })

    it('allows create-time tag on new machine rows', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine(
            'machine-new',
            { host: 'fresh' },
            null,
            'ns',
            'create-tag'
        )
        expect(created.tag).toBe('create-tag')
        const again = store.machines.getOrCreateMachine(
            'machine-new',
            { host: 'fresh' },
            null,
            'ns',
            'create-tag'
        )
        expect(again.tag).toBe('create-tag')
    })

    it('rejects tagless re-registration against an already tagged machine', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-tagged',
            { host: 'alpha' },
            { capabilities: { piExistingSessionResume: true } },
            'ns',
            'secret-tag'
        )

        expect(() =>
            store.machines.getOrCreateMachine(
                'machine-tagged',
                { host: 'attacker' },
                { capabilities: { piExistingSessionResume: false } },
                'ns'
            )
        ).toThrow(MachineTagConflictError)

        const row = store.machines.getMachine('machine-tagged')
        expect(row?.metadata).toEqual({ host: 'alpha' })
        expect(row?.runnerState).toEqual({ capabilities: { piExistingSessionResume: true } })
    })
})

const runnerAlive = { status: 'running' as const }

describe('machine metadata backfill', () => {
    it('merges incoming metadata over stored fields on runner re-registration', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', null, runnerAlive, 'ns')
        expect(created.metadata).toBeNull()

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'MacBook Pro', platform: 'darwin' },
            runnerAlive,
            'ns'
        )

        expect(refreshed.metadata).toEqual({
            host: 'MacBook Pro',
            platform: 'darwin',
            capabilities: [],
        })
        expect(refreshed.metadataVersion).toBe(created.metadataVersion + 1)
    })

    it('preserves hub-side fields the CLI never sends', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-1',
            { displayName: 'Workstation', host: 'old-host' },
            runnerAlive,
            'ns'
        )

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'new-host' },
            runnerAlive,
            'ns'
        )

        expect(refreshed.metadata).toEqual({
            displayName: 'Workstation',
            host: 'new-host',
            capabilities: [],
        })
    })

    it('does not write when the merge changes nothing', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'alpha' },
            runnerAlive,
            'ns'
        )

        const again = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'alpha' },
            runnerAlive,
            'ns'
        )

        expect(again.metadataVersion).toBe(created.metadataVersion)
        expect(again.updatedAt).toBe(created.updatedAt)
    })

    it('ignores terminal bootstrap metadata when runnerState is null', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'alpha', happyCliVersion: '0.20.2' },
            runnerAlive,
            'ns'
        )

        const again = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'beta', happyCliVersion: '0.23.4' },
            null,
            'ns'
        )

        expect(again.metadata).toEqual(created.metadata)
        expect(again.metadataVersion).toBe(created.metadataVersion)
    })
})

describe('mergeMachineMetadata', () => {
    it('returns undefined for non-object incoming metadata', () => {
        expect(mergeMachineMetadata({ host: 'a' }, null)).toBeUndefined()
        expect(mergeMachineMetadata({ host: 'a' }, 'host')).toBeUndefined()
        expect(mergeMachineMetadata({ host: 'a' }, ['host'])).toBeUndefined()
    })

    it('returns undefined when the merge is a no-op', () => {
        expect(mergeMachineMetadata({ host: 'a' }, { host: 'a' })).toBeUndefined()
    })
})

describe('runner capabilities backfill', () => {
    it('merges registration-time capabilities into an existing machine', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', null, { status: 'offline', pid: 1 }, 'ns')
        expect(created.runnerState).toEqual({ status: 'offline', pid: 1 })

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            null,
            { status: 'offline', pid: 2, capabilities: { piExistingSessionResume: true } },
            'ns'
        )

        expect(refreshed.runnerState).toEqual({
            status: 'offline',
            pid: 1,
            capabilities: { piExistingSessionResume: true }
        })
        expect(refreshed.runnerStateVersion).toBe(created.runnerStateVersion + 1)
    })

    it('keeps live runner-state fields socket-owned on registration', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine('machine-1', null, { status: 'running', pid: 99 }, 'ns')

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            null,
            { status: 'offline', pid: 100, startedAt: 1, capabilities: { piExistingSessionResume: true } },
            'ns'
        )

        expect(refreshed.runnerState).toEqual({
            status: 'running',
            pid: 99,
            capabilities: { piExistingSessionResume: true }
        })
    })

    it('does not write when capabilities are unchanged or absent', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine(
            'machine-1',
            null,
            { status: 'running', capabilities: { piExistingSessionResume: true } },
            'ns'
        )

        const unchanged = store.machines.getOrCreateMachine(
            'machine-1',
            null,
            { status: 'offline', capabilities: { piExistingSessionResume: true } },
            'ns'
        )
        expect(unchanged.runnerStateVersion).toBe(created.runnerStateVersion)

        const noCaps = store.machines.getOrCreateMachine('machine-1', null, { status: 'offline' }, 'ns')
        expect(noCaps.runnerStateVersion).toBe(created.runnerStateVersion)
    })

    it('merges capabilities even when metadata also changes in the same call', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', { host: 'old-host' }, { status: 'offline', pid: 1 }, 'ns')

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'new-host', happyCliVersion: '0.28.0' },
            { status: 'offline', pid: 2, capabilities: { piExistingSessionResume: true } },
            'ns'
        )

        expect(refreshed.metadata).toEqual({
            host: 'new-host',
            happyCliVersion: '0.28.0',
            capabilities: [],
        })
        expect(refreshed.metadataVersion).toBe(created.metadataVersion + 1)
        expect(refreshed.runnerState).toEqual({
            status: 'offline',
            pid: 1,
            capabilities: { piExistingSessionResume: true }
        })
        expect(refreshed.runnerStateVersion).toBe(created.runnerStateVersion + 1)
    })
})
