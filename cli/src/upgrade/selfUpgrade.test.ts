import { afterEach, describe, expect, it } from 'vitest'
import {
    __resetRunnerSelfUpgradeGateForTests,
    __setRunnerSelfUpgradeInFlightForTests,
    applyRunnerSelfUpgrade,
    artifactInstallFileName,
    assertExecutableMatchesTargetVersion,
    resolvePostNpmInstallExecutable,
    shouldApplyUpgradeOffer,
} from './selfUpgrade'
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

    it('applies hub-artifact when version/capabilities match but generation drifts', () => {
        expect(shouldApplyUpgradeOffer(
            baseOffer({
                channel: 'hub-artifact',
                targetVersion: '0.24.0',
                targetCapabilities: [...CURRENT_MACHINE_CAPABILITIES],
                targetGeneration: 'gen-b',
                artifact: {
                    url: '/api/upgrade/cli-artifact',
                    sha256: 'abc',
                    platform: 'linux',
                    arch: 'x64',
                    sizeBytes: 10,
                },
            }),
            '0.24.0',
            CURRENT_MACHINE_CAPABILITIES,
            'gen-a',
        )).toEqual({
            apply: true,
            reason: 'upgrade',
        })
    })

    it('skips hub-artifact when generation already matches', () => {
        expect(shouldApplyUpgradeOffer(
            baseOffer({
                channel: 'hub-artifact',
                targetVersion: '0.24.0',
                targetCapabilities: [...CURRENT_MACHINE_CAPABILITIES],
                targetGeneration: 'gen-a',
                artifact: {
                    url: '/api/upgrade/cli-artifact',
                    sha256: 'abc',
                    platform: 'linux',
                    arch: 'x64',
                    sizeBytes: 10,
                },
            }),
            '0.24.0',
            CURRENT_MACHINE_CAPABILITIES,
            'gen-a',
        )).toEqual({
            apply: false,
            reason: 'already-current',
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

describe('assertExecutableMatchesTargetVersion', () => {
    it('accepts --version output that includes the target', async () => {
        await expect(assertExecutableMatchesTargetVersion(
            '/fake/hapi',
            '0.24.0',
            async () => ({ ok: true, output: 'hapi version: 0.24.0\n' }),
        )).resolves.toBeUndefined()
    })

    it('rejects an older PATH hit after install', async () => {
        await expect(assertExecutableMatchesTargetVersion(
            '/old/hapi',
            '0.24.0',
            async () => ({ ok: true, output: 'hapi version: 0.20.0\n' }),
        )).rejects.toThrow(/does not match target 0\.24\.0/)
    })

    it('rejects a failed version probe', async () => {
        await expect(assertExecutableMatchesTargetVersion(
            '/broken/hapi',
            '0.24.0',
            async () => ({ ok: false, output: 'ENOENT' }),
        )).rejects.toThrow(/does not match target/)
    })
})

describe('applyRunnerSelfUpgrade concurrency gate', () => {
    afterEach(() => {
        __resetRunnerSelfUpgradeGateForTests()
    })

    it('fails closed when another upgrade is already in flight', async () => {
        __setRunnerSelfUpgradeInFlightForTests(true)
        const result = await applyRunnerSelfUpgrade({
            offer: baseOffer(),
            downloadBaseUrl: 'http://localhost',
            authToken: 't',
            localVersion: '0.20.0',
        })
        expect(result).toEqual({
            status: 'failed',
            message: 'Runner upgrade already in progress',
            channel: 'npm',
        })
    })
})

describe('artifactInstallFileName', () => {
    it('embeds a sha prefix so same-version rebuilds use distinct paths', () => {
        const oldSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        const newSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        expect(artifactInstallFileName('0.25.1', oldSha, 'win32')).toBe('hapi-0.25.1-aaaaaaaaaaaaaaaa.exe')
        expect(artifactInstallFileName('0.25.1', newSha, 'win32')).toBe('hapi-0.25.1-bbbbbbbbbbbbbbbb.exe')
        expect(artifactInstallFileName('0.25.1', oldSha, 'linux')).toBe('hapi-0.25.1-aaaaaaaaaaaaaaaa')
        expect(artifactInstallFileName('0.25.1', oldSha, 'win32'))
            .not.toBe(artifactInstallFileName('0.25.1', newSha, 'win32'))
    })
})
