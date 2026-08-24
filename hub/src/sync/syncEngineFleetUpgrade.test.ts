import { describe, expect, it, mock } from 'bun:test'
import { CURRENT_MACHINE_CAPABILITIES } from '@hapi/protocol/runnerCapabilities'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

const TEST_OFFER: HubUpgradeOffer = {
    channel: 'hub-artifact',
    targetVersion: '0.27.3',
    targetCapabilities: [...CURRENT_MACHINE_CAPABILITIES],
    targetGeneration: 'hub-generation-new',
}

function makeEngine(options?: {
    policy?: 'silent' | 'alert' | 'auto'
    offer?: HubUpgradeOffer | null
}) {
    const store = new Store(':memory:')
    const engine = new SyncEngine(
        store,
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never,
        {
            getUpgradeOffer: options?.offer === null
                ? undefined
                : () => options?.offer ?? TEST_OFFER,
            getFleetUpgradePolicy: () => options?.policy ?? 'auto',
        },
    )
    return { store, engine }
}

function registerSkewedRunner(
    engine: SyncEngine,
    id: string,
    overrides?: { generation?: string; versionHandoffDisabled?: boolean },
) {
    engine.getOrCreateMachine(
        id,
        {
            host: id,
            platform: 'linux',
            happyCliVersion: TEST_OFFER.targetVersion,
            capabilities: [...CURRENT_MACHINE_CAPABILITIES],
            cliArtifactGeneration: overrides?.generation ?? 'runner-generation-old',
            versionHandoffDisabled: overrides?.versionHandoffDisabled,
        },
        null,
        'default',
    )
    engine.handleMachineAlive({ machineId: id, time: Date.now() })
}

describe('SyncEngine fleet upgrade startup sweep', () => {
    it('does nothing when fleet policy is not auto', async () => {
        const { engine } = makeEngine({ policy: 'alert' })
        const upgrade = mock(async () => ({
            type: 'success' as const,
            message: 'ok',
            response: { status: 'started' as const, message: 'ok' },
        }))
        engine.upgradeMachineRunner = upgrade

        try {
            registerSkewedRunner(engine, 'homelab')
            await (engine as unknown as { runFleetUpgradeStartupSweep(): Promise<void> }).runFleetUpgradeStartupSweep()
            expect(upgrade).not.toHaveBeenCalled()
        } finally {
            engine.stop()
        }
    })

    it('upgrades every active skewed runner and bypasses cooldown', async () => {
        const { engine } = makeEngine()
        const upgraded: string[] = []
        engine.upgradeMachineRunner = mock(async (machineId: string) => {
            upgraded.push(machineId)
            return {
                type: 'success' as const,
                message: 'ok',
                response: { status: 'started' as const, message: 'ok' },
            }
        })

        try {
            registerSkewedRunner(engine, 'homelab')
            registerSkewedRunner(engine, 'personal-win')
            upgraded.length = 0

            // Simulate a recent heartbeat auto attempt that would block retries.
            const internals = engine as unknown as { fleetUpgradeAttemptAt: Map<string, number> }
            internals.fleetUpgradeAttemptAt.set('homelab', Date.now())
            internals.fleetUpgradeAttemptAt.set('personal-win', Date.now())

            await (engine as unknown as { runFleetUpgradeStartupSweep(): Promise<void> }).runFleetUpgradeStartupSweep()
            expect(upgraded.sort()).toEqual(['homelab', 'personal-win'])
        } finally {
            engine.stop()
        }
    })

    it('skips versionHandoffDisabled hosts', async () => {
        const { engine } = makeEngine()
        const upgraded: string[] = []
        engine.upgradeMachineRunner = mock(async (machineId: string) => {
            upgraded.push(machineId)
            return {
                type: 'success' as const,
                message: 'ok',
                response: { status: 'started' as const, message: 'ok' },
            }
        })

        try {
            registerSkewedRunner(engine, 'homelab')
            registerSkewedRunner(engine, 'oos', { versionHandoffDisabled: true })
            upgraded.length = 0

            await (engine as unknown as { runFleetUpgradeStartupSweep(): Promise<void> }).runFleetUpgradeStartupSweep()
            expect(upgraded).toEqual(['homelab'])
        } finally {
            engine.stop()
        }
    })

    it('clears auto cooldown when hub targetGeneration moves', async () => {
        let targetGeneration = 'gen-old'
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            {
                getUpgradeOffer: () => ({ ...TEST_OFFER, targetGeneration }),
                getFleetUpgradePolicy: () => 'auto',
            },
        )
        const upgraded: string[] = []
        engine.upgradeMachineRunner = mock(async (machineId: string) => {
            upgraded.push(machineId)
            return { type: 'success' as const, message: 'ok', response: { status: 'started' as const, message: 'ok' } }
        })
        const maybeUpgrade = (engine as unknown as {
            maybeFleetUpgradeMachine(id: string): Promise<void>
        }).maybeFleetUpgradeMachine.bind(engine)

        try {
            registerSkewedRunner(engine, 'homelab')
            upgraded.length = 0
            const internals = engine as unknown as { fleetUpgradeAttemptAt: Map<string, number> }
            internals.fleetUpgradeAttemptAt.set('homelab', Date.now())

            await maybeUpgrade('homelab')
            expect(upgraded).toEqual([])

            targetGeneration = 'gen-new'
            await maybeUpgrade('homelab')
            expect(upgraded).toEqual(['homelab'])
        } finally {
            engine.stop()
        }
    })
})
