import { describe, expect, it } from 'vitest'
import { resolvePostNpmInstallExecutable, shouldApplyUpgradeOffer } from './selfUpgrade'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import { CURRENT_MACHINE_CAPABILITIES } from '@hapi/protocol/runnerCapabilities'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseOffer = (overrides: Partial<HubUpgradeOffer> = {}): HubUpgradeOffer => ({
    channel: 'npm',
    targetVersion: '0.24.0',
    targetCapabilities: ['cursor-chat-store-status'],
    npmPackage: '@twsxtd/hapi',
    ...overrides,
})

describe('resolvePostNpmInstallExecutable', () => {
    it('returns the first PATH hit that exists on disk', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-npm-upgrade-'))
        const shim = join(dir, 'hapi')
        writeFileSync(shim, '#!/bin/sh\n')
        expect(resolvePostNpmInstallExecutable((name) => (name === 'hapi' ? shim : null))).toBe(shim)
    })

    it('returns null when nothing on PATH exists', () => {
        expect(resolvePostNpmInstallExecutable(() => '/tmp/definitely-missing-hapi-binary')).toBeNull()
        expect(resolvePostNpmInstallExecutable(() => null)).toBeNull()
    })
})

describe('shouldApplyUpgradeOffer', () => {
    it('skips when channel is off', () => {
        expect(shouldApplyUpgradeOffer(baseOffer({ channel: 'off' }), '0.20.0')).toEqual({
            apply: false,
            reason: 'unsupported',
        })
    })

    it('skips when local version and capabilities already match target', () => {
        expect(shouldApplyUpgradeOffer(
            baseOffer({
                targetCapabilities: [...CURRENT_MACHINE_CAPABILITIES],
            }),
            '0.24.0',
            CURRENT_MACHINE_CAPABILITIES,
        )).toEqual({
            apply: false,
            reason: 'already-current',
        })
    })

    it('applies when version matches but target capabilities are missing', () => {
        expect(shouldApplyUpgradeOffer(
            baseOffer({
                targetVersion: '0.24.0',
                targetCapabilities: ['cursor-chat-store-status', 'runner-self-upgrade'],
            }),
            '0.24.0',
            ['cursor-chat-store-status'],
        )).toEqual({
            apply: true,
            reason: 'upgrade',
        })
    })

    it('applies when behind on npm channel', () => {
        expect(shouldApplyUpgradeOffer(baseOffer(), '0.20.0')).toEqual({
            apply: true,
            reason: 'upgrade',
        })
    })

    it('applies hub-artifact when behind', () => {
        expect(shouldApplyUpgradeOffer(baseOffer({
            channel: 'hub-artifact',
            artifact: {
                url: '/api/upgrade/cli-artifact',
                sha256: 'abc',
                platform: 'linux',
                arch: 'x64',
                sizeBytes: 10,
            },
        }), '0.18.4')).toEqual({
            apply: true,
            reason: 'upgrade',
        })
    })

    it('rejects hub-artifact without sha when apply would need verify', () => {
        expect(shouldApplyUpgradeOffer(baseOffer({
            channel: 'hub-artifact',
            artifact: {
                url: '/api/upgrade/cli-artifact',
                sha256: '',
                platform: 'linux',
                arch: 'x64',
                sizeBytes: 0,
            },
        }), '0.18.4')).toEqual({
            apply: false,
            reason: 'unsupported',
        })
    })
})
