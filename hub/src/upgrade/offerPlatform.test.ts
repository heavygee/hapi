import { describe, expect, it } from 'bun:test'
import {
    listSoupAvailablePlatforms,
    normalizeOfferPlatform,
    resolveOfferPlatformArch,
    soupTipHasPlatform,
} from './offerPlatform'
import type { PublishedSoupTip } from './soupArtifact'

describe('normalizeOfferPlatform', () => {
    it('maps windows aliases to win32', () => {
        expect(normalizeOfferPlatform('windows')).toBe('win32')
        expect(normalizeOfferPlatform('win')).toBe('win32')
        expect(normalizeOfferPlatform('WIN32')).toBe('win32')
        expect(normalizeOfferPlatform('linux')).toBe('linux')
    })
})

describe('resolveOfferPlatformArch', () => {
    it('prefers query over headers over fallback', () => {
        expect(resolveOfferPlatformArch({
            queryPlatform: 'win32',
            queryArch: 'x64',
            headerPlatform: 'linux',
            headerArch: 'arm64',
            fallbackPlatform: 'linux',
            fallbackArch: 'x64',
        })).toEqual({ platform: 'win32', arch: 'x64', fromRequest: true })
    })

    it('infers x64 arch when only platform is requested', () => {
        expect(resolveOfferPlatformArch({
            queryPlatform: 'windows',
            fallbackPlatform: 'linux',
            fallbackArch: 'arm64',
        })).toEqual({ platform: 'win32', arch: 'x64', fromRequest: true })
    })
})

describe('listSoupAvailablePlatforms', () => {
    it('dedupes and maps soup windows → win32', () => {
        const tip = {
            root: '/tmp',
            tag: 'hapi-soup-vtest',
            composedTipSha: 'abc',
            manifestPath: '/tmp/manifest.json',
            binaries: [
                { target: 'a', platform: 'linux', arch: 'x64', path: 'l', sha256: '1', sizeBytes: 1 },
                { target: 'b', platform: 'windows', arch: 'x64', path: 'w', sha256: '2', sizeBytes: 1 },
                { target: 'c', platform: 'linux', arch: 'x64', variant: 'baseline', path: 'l2', sha256: '3', sizeBytes: 1 },
            ],
        } satisfies PublishedSoupTip
        expect(listSoupAvailablePlatforms(tip)).toEqual([
            { platform: 'linux', arch: 'x64' },
            { platform: 'win32', arch: 'x64' },
        ])
        expect(soupTipHasPlatform(tip, 'win32', 'x64')).toBe(true)
        expect(soupTipHasPlatform(tip, 'windows', 'x64')).toBe(true)
        expect(soupTipHasPlatform(tip, 'darwin', 'arm64')).toBe(false)
    })
})
