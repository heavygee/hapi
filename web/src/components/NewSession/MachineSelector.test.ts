import { describe, expect, it } from 'vitest'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import type { Machine } from '@/types/api'
import { machineNeedsUpdateLabel } from './MachineSelector'

const OFFER: HubUpgradeOffer = {
    channel: 'npm',
    targetVersion: '0.24.0',
    targetCapabilities: ['cursor-chat-store-status'],
    npmPackage: '@twsxtd/hapi',
}

function makeMachine(overrides: Partial<Machine> & { id?: string }): Machine {
    return {
        id: overrides.id ?? 'm1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: overrides.active ?? true,
        activeAt: Date.now(),
        metadata: overrides.metadata ?? {
            host: 'teemo',
            platform: 'win32',
            happyCliVersion: '0.23.0',
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 0,
        ...overrides,
    } as Machine
}

describe('machineNeedsUpdateLabel', () => {
    it('matches banner: version drift triggers UPDATE REQUIRED', () => {
        expect(machineNeedsUpdateLabel(
            makeMachine({ metadata: { host: 'teemo', platform: 'win32', happyCliVersion: '0.23.0' } }),
            OFFER,
            'alert',
        )).toBe(true)
    })

    it('hides under silent policy; still labels soup handoff opt-out when skewed', () => {
        const behind = makeMachine({ metadata: { host: 'teemo', platform: 'win32', happyCliVersion: '0.23.0' } })
        expect(machineNeedsUpdateLabel(behind, OFFER, 'silent')).toBe(false)
        expect(machineNeedsUpdateLabel(
            makeMachine({
                metadata: {
                    host: 'proxmox',
                    platform: 'linux',
                    happyCliVersion: '0.20.0',
                    versionHandoffDisabled: true,
                },
            }),
            OFFER,
            'alert',
        )).toBe(true)
    })

    it('does not label handoff-disabled hosts on generation-only drift', () => {
        const artifactOffer: HubUpgradeOffer = {
            channel: 'hub-artifact',
            targetVersion: '0.24.0',
            targetCapabilities: ['cursor-chat-store-status'],
            targetGeneration: 'gen-b',
            artifact: {
                url: '/cli/upgrade/cli-artifact',
                sha256: 'abc',
                platform: 'linux',
                arch: 'x64',
                sizeBytes: 1,
            },
        }
        expect(machineNeedsUpdateLabel(
            makeMachine({
                metadata: {
                    host: 'proxmox',
                    platform: 'linux',
                    happyCliVersion: '0.24.0',
                    capabilities: ['cursor-chat-store-status'],
                    versionHandoffDisabled: true,
                },
            }),
            artifactOffer,
            'alert',
        )).toBe(false)
        expect(machineNeedsUpdateLabel(
            makeMachine({
                metadata: {
                    host: 'proxmox',
                    platform: 'linux',
                    happyCliVersion: '0.24.0',
                    capabilities: ['cursor-chat-store-status'],
                    versionHandoffDisabled: true,
                    startedCliMtimeMs: 1,
                    installedCliMtimeMs: 2,
                },
            }),
            artifactOffer,
            'alert',
        )).toBe(true)
    })
})
