import { describe, expect, it, mock } from 'bun:test'
import { CURRENT_MACHINE_CAPABILITIES } from '@hapi/protocol/runnerCapabilities'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import {
    resetFleetUpgradePolicyForTests,
    setFleetUpgradeMachinePolicy,
} from '../upgrade/fleetUpgradePolicy'
import { SyncEngine } from './syncEngine'

const TEST_OFFER: HubUpgradeOffer = {
    channel: 'hub-artifact',
    targetVersion: '0.27.3',
    targetCapabilities: [...CURRENT_MACHINE_CAPABILITIES],
    targetGeneration: 'hub-generation-new',
}

type UpgradeRunner = SyncEngine['upgradeMachineRunner']

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
            getFleetUpgradePolicy: () => options?.policy ?? 'alert',
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

describe('SyncEngine deliberate fleet push', () => {
    it('keepalive does not auto-upgrade even when hub policy is auto', async () => {
        const { engine } = makeEngine({ policy: 'auto' })
        const upgrade = mock(async () => ({
            type: 'success' as const,
            message: 'ok',
            response: { status: 'started' as const, message: 'ok' },
        }))
        engine.upgradeMachineRunner = upgrade as unknown as UpgradeRunner

        try {
            registerSkewedRunner(engine, 'homelab')
            engine.handleMachineAlive({ machineId: 'homelab', time: Date.now() })
            await Bun.sleep(10)
            expect(upgrade).not.toHaveBeenCalled()
        } finally {
            engine.stop()
        }
    })

    it('push upgrades only machines with effective auto policy', async () => {
        resetFleetUpgradePolicyForTests()
        const { engine } = makeEngine({ policy: 'alert' })
        const upgraded: string[] = []
        engine.upgradeMachineRunner = mock(async (machineId: string) => {
            upgraded.push(machineId)
            return {
                type: 'success' as const,
                message: 'ok',
                response: { status: 'started' as const, message: 'ok' },
            }
        }) as unknown as UpgradeRunner

        try {
            registerSkewedRunner(engine, 'ninja')
            registerSkewedRunner(engine, 'homelab')
            await setFleetUpgradeMachinePolicy('ninja', 'auto')

            const { results } = await engine.pushFleetUpgrade({
                namespace: 'default',
                machineIds: ['ninja', 'homelab'],
            })
            expect(upgraded).toEqual(['ninja'])
            expect(results.find((row) => row.machineId === 'ninja')?.action).toBe('upgraded')
            expect(results.find((row) => row.machineId === 'homelab')?.action).toBe('banner')
        } finally {
            engine.stop()
            resetFleetUpgradePolicyForTests()
        }
    })

    it('push skips silent machines', async () => {
        resetFleetUpgradePolicyForTests()
        const { engine } = makeEngine({ policy: 'alert' })
        const upgrade = mock(async () => ({
            type: 'success' as const,
            message: 'ok',
            response: { status: 'started' as const, message: 'ok' },
        }))
        engine.upgradeMachineRunner = upgrade as unknown as UpgradeRunner

        try {
            registerSkewedRunner(engine, 'ian')
            await setFleetUpgradeMachinePolicy('ian', 'silent')
            const { results } = await engine.pushFleetUpgrade({
                namespace: 'default',
                machineIds: ['ian'],
            })
            expect(upgrade).not.toHaveBeenCalled()
            expect(results[0]?.action).toBe('skipped')
        } finally {
            engine.stop()
            resetFleetUpgradePolicyForTests()
        }
    })

    it('forceAlert applies to alert machines on deliberate push', async () => {
        resetFleetUpgradePolicyForTests()
        const { engine } = makeEngine({ policy: 'alert' })
        const upgraded: string[] = []
        engine.upgradeMachineRunner = mock(async (machineId: string) => {
            upgraded.push(machineId)
            return {
                type: 'success' as const,
                message: 'ok',
                response: { status: 'started' as const, message: 'ok' },
            }
        }) as unknown as UpgradeRunner

        try {
            registerSkewedRunner(engine, 'homelab')
            const { results } = await engine.pushFleetUpgrade({
                namespace: 'default',
                machineIds: ['homelab'],
                forceAlert: true,
            })
            expect(upgraded).toEqual(['homelab'])
            expect(results[0]?.action).toBe('upgraded')
        } finally {
            engine.stop()
            resetFleetUpgradePolicyForTests()
        }
    })
})
