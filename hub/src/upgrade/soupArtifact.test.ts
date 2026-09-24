import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
    mkdirSync,
    mkdtempSync,
    writeFileSync,
    rmSync,
    readFileSync,
    symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    ensureSoupCliArtifact,
    findSoupBinary,
    preferPublishedSoupTip,
    readPublishedSoupTip,
    soupTipToUpgradeOffer,
    isSoupTipOffer,
} from './soupArtifact'

function writeTipFixture(root: string, tag: string, tipSha: string): string {
    const tipDir = join(root, tag)
    const binDir = join(tipDir, 'linux-x64-baseline')
    mkdirSync(binDir, { recursive: true })
    const binPath = join(binDir, 'hapi')
    const bytes = `soup-binary-${tag}`
    writeFileSync(binPath, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(tipDir, 'manifest.json'), `${JSON.stringify({
        schema: 1,
        tag,
        composedTipSha: tipSha,
        binaries: [{
            target: 'bun-linux-x64-baseline',
            platform: 'linux',
            arch: 'x64',
            variant: 'baseline',
            path: 'linux-x64-baseline/hapi',
            sha256,
            sizeBytes: Buffer.byteLength(bytes),
        }],
    }, null, 2)}\n`)
    return tipDir
}

describe('preferPublishedSoupTip', () => {
    it('defaults on and honors explicit off', () => {
        expect(preferPublishedSoupTip({})).toBe(true)
        expect(preferPublishedSoupTip({ HAPI_UPGRADE_PREFER_SOUP: '0' })).toBe(false)
        expect(preferPublishedSoupTip({ HAPI_UPGRADE_PREFER_SOUP: 'false' })).toBe(false)
        expect(preferPublishedSoupTip({ HAPI_UPGRADE_PREFER_SOUP: '1' })).toBe(true)
    })
})

describe('readPublishedSoupTip / soupTipToUpgradeOffer', () => {
    it('reads latest symlink and builds a tag-keyed hub-artifact offer', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-offer-'))
        try {
            const tag = 'hapi-soup-v2026.09.24-c699518'
            writeTipFixture(root, tag, 'c699518dbf3c2cc247b145b44c10d220846efba8')
            // latest -> tag (relative symlink like production)
            symlinkSync(tag, join(root, 'latest'))

            const tip = readPublishedSoupTip(root)
            expect(tip?.tag).toBe(tag)
            expect(tip?.composedTipSha.startsWith('c699518')).toBe(true)

            const found = findSoupBinary(tip!, 'linux', 'x64')
            expect(found?.entry.sha256).toHaveLength(64)

            const offer = soupTipToUpgradeOffer(tip!, 'linux', 'x64', {
                channel: 'hub-artifact',
                targetVersion: '0.30.7',
                targetCapabilities: ['runner-self-upgrade'],
            })
            expect(offer?.targetVersion).toBe(tag)
            expect(offer?.targetGeneration).toBe(tag)
            expect(offer?.artifact?.sha256).toBe(found!.entry.sha256)
            expect(isSoupTipOffer(offer!)).toBe(true)
            // Must NOT keep stock semver — that is the stomp footgun.
            expect(offer?.targetVersion).not.toBe('0.30.7')
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('returns null when no soup tip is published', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-empty-'))
        try {
            expect(readPublishedSoupTip(root)).toBeNull()
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})

describe('ensureSoupCliArtifact', () => {
    it('mirrors soup bytes into upgrade-artifacts with tag as sourceFingerprint', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-ensure-'))
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-data-'))
        try {
            const tag = 'hapi-soup-v2026.09.24-c699518'
            writeTipFixture(root, tag, 'c699518dbf3c2cc247b145b44c10d220846efba8')
            writeFileSync(join(root, 'latest-tag.txt'), `${tag}\n`)

            const tip = readPublishedSoupTip(root)!
            const meta = ensureSoupCliArtifact({
                tip,
                platform: 'linux',
                arch: 'x64',
                dataDir,
            })
            expect(meta.version).toBe(tag)
            expect(meta.sourceFingerprint).toBe(tag)
            expect(meta.sha256).toHaveLength(64)
            expect(readFileSync(meta.path, 'utf8')).toContain('soup-binary-')

            // Second call is a cache hit on matching digest.
            const again = ensureSoupCliArtifact({
                tip,
                platform: 'linux',
                arch: 'x64',
                dataDir,
            })
            expect(again.path).toBe(meta.path)
            expect(again.sha256).toBe(meta.sha256)
        } finally {
            rmSync(root, { recursive: true, force: true })
            rmSync(dataDir, { recursive: true, force: true })
        }
    })
})
