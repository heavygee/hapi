import { describe, expect, it } from 'bun:test'
import { Store } from './index'
import { MachineTagConflictError, mergeMachineMetadata } from './machines'
import { hashRunnerProof } from '../utils/runnerProof'

describe('machine tag enrollment (#1473)', () => {
    it('binds runnerProofHash on create and refuses tag-only proof rebind (#1473)', () => {
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

        // Cold restart must re-present the same durable proof — inventing a new
        // proof from machineTag alone is the Blocker.
        expect(() => store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'h2' },
            null,
            'ns',
            'secret-tag',
            'proof-b'
        )).toThrow(/runner proof mismatch/)
        expect(store.machines.getMachine('machine-proof')?.runnerProofHash).toBe(hashRunnerProof('proof-a'))

        const sameProof = store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'h2' },
            null,
            'ns',
            'secret-tag',
            'proof-a'
        )
        expect(sameProof.id).toBe('machine-proof')
        expect(sameProof.runnerProofHash).toBe(hashRunnerProof('proof-a'))
        expect(sameProof.metadata).toEqual({ host: 'h2' })

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

        expect(() => store.machines.getOrCreateMachine(
            'machine-proof',
            { host: 'omit' },
            null,
            'ns',
            'secret-tag'
        )).toThrow(/runner proof mismatch/)
        store.close()
    })

    it('refuses wrong-proof re-registration for a live machine', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-live',
            { host: 'h' },
            { status: 'online', pid: 1 },
            'ns',
            'secret-tag',
            'proof-a'
        )
        const live = store.machines.getMachine('machine-live')
        expect(live).toBeTruthy()
        store.machines.updateMachineRunnerState(
            'machine-live',
            { status: 'online', pid: 1 },
            live!.runnerStateVersion,
            'ns'
        )
        expect(store.machines.getMachine('machine-live')?.active).toBe(true)
        expect(() => store.machines.getOrCreateMachine(
            'machine-live',
            { host: 'h' },
            null,
            'ns',
            'secret-tag',
            'proof-restart'
        )).toThrow(/runner proof mismatch/)
        expect(store.machines.getMachine('machine-live')?.runnerProofHash).toBe(hashRunnerProof('proof-a'))
        store.close()
    })

    it('keeps local-resume mint unavailable after rejected live tag/wrong-proof re-registration', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-mint',
            { host: 'h' },
            null,
            'ns',
            'secret-tag',
            'proof-owner'
        )
        expect(() => store.machines.getOrCreateMachine(
            'machine-mint',
            { host: 'attacker' },
            null,
            'ns',
            'secret-tag',
            'proof-forged'
        )).toThrow(MachineTagConflictError)
        const row = store.machines.getMachine('machine-mint')
        expect(row?.runnerProofHash).toBe(hashRunnerProof('proof-owner'))
        expect(row?.metadata).toEqual({ host: 'h' })
        expect(row?.runnerProofHash).not.toBe(hashRunnerProof('proof-forged'))
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

describe('machine metadata backfill', () => {
    it('merges incoming metadata over stored fields on re-registration', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', null, null, 'ns')
        expect(created.metadata).toBeNull()

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'MacBook Pro', platform: 'darwin' },
            null,
            'ns'
        )

        expect(refreshed.metadata).toEqual({ host: 'MacBook Pro', platform: 'darwin' })
        expect(refreshed.metadataVersion).toBe(created.metadataVersion + 1)
    })

    it('preserves hub-side fields the CLI never sends', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine('machine-1', { displayName: 'Workstation', host: 'old-host' }, null, 'ns')

        const refreshed = store.machines.getOrCreateMachine('machine-1', { host: 'new-host' }, null, 'ns')

        expect(refreshed.metadata).toEqual({ displayName: 'Workstation', host: 'new-host' })
    })

    it('does not write when the merge changes nothing', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'ns')

        const again = store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'ns')

        expect(again.metadataVersion).toBe(created.metadataVersion)
        expect(again.updatedAt).toBe(created.updatedAt)
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

    it('clears omitted runner ads when clearOmittedRunnerAds is set', () => {
        const merged = mergeMachineMetadata(
            {
                host: 'box',
                capabilities: ['stop-runner'],
                supervisedRestart: true,
                startedCliMtimeMs: 1,
                installedCliMtimeMs: 2,
                displayName: 'keep-me',
            },
            { host: 'box', supervisedRestart: false },
            { clearOmittedRunnerAds: true },
        )
        expect(merged).toEqual({
            host: 'box',
            supervisedRestart: false,
            displayName: 'keep-me',
        })
    })

    it('keeps sticky runner ads without clearOmittedRunnerAds (terminal bootstrap)', () => {
        const merged = mergeMachineMetadata(
            { host: 'box', capabilities: ['stop-runner'], supervisedRestart: true },
            { host: 'box' },
        )
        expect(merged).toBeUndefined()
    })
})

describe('runner metadata ad clear on re-registration', () => {
    it('drops sticky supervisedRestart and capabilities when runner re-registers without them', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-1',
            {
                host: 'box',
                capabilities: ['stop-runner'],
                supervisedRestart: true,
                startedCliMtimeMs: 10,
            },
            { status: 'running', pid: 1 },
            'ns',
        )

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'box', supervisedRestart: false },
            { status: 'running', pid: 2 },
            'ns',
        )

        expect(refreshed.metadata).toEqual({ host: 'box', supervisedRestart: false })
        expect(refreshed.metadata).not.toHaveProperty('capabilities')
        expect(refreshed.metadata).not.toHaveProperty('startedCliMtimeMs')
    })

    it('does not clear runner ads on terminal-only metadata refresh (no runnerState)', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'box', capabilities: ['stop-runner'], supervisedRestart: true },
            { status: 'running', pid: 1 },
            'ns',
        )

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'box' },
            null,
            'ns',
        )

        expect(refreshed.metadata).toEqual({
            host: 'box',
            capabilities: ['stop-runner'],
            supervisedRestart: true,
        })
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

        expect(refreshed.metadata).toEqual({ host: 'new-host', happyCliVersion: '0.28.0' })
        expect(refreshed.metadataVersion).toBe(created.metadataVersion + 1)
        expect(refreshed.runnerState).toEqual({
            status: 'offline',
            pid: 1,
            capabilities: { piExistingSessionResume: true }
        })
        expect(refreshed.runnerStateVersion).toBe(created.runnerStateVersion + 1)
    })
})
