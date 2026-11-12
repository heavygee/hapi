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
            expect(offer?.soupTag).toBe(tag)
            expect(offer?.releaseNotes).toBeUndefined()
            expect(offer?.artifact?.sha256).toBe(found!.entry.sha256)
            expect(isSoupTipOffer(offer!)).toBe(true)
            // Must NOT keep stock semver — that is the stomp footgun.
            expect(offer?.targetVersion).not.toBe('0.30.7')
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('attaches NOTES.md release notes to the soup tip offer', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-notes-'))
        try {
            const tag = 'hapi-soup-v2026.10.11-abc1234'
            const tipDir = writeTipFixture(root, tag, 'abc1234deadbeef')
            writeFileSync(join(tipDir, 'NOTES.md'), '### Changes\n\n- feat: deliberate fleet push (#247)\n')
            symlinkSync(tag, join(root, 'latest'))

            const tip = readPublishedSoupTip(root)
            expect(tip?.releaseNotes).toContain('deliberate fleet push')
            const offer = soupTipToUpgradeOffer(tip!, 'linux', 'x64', {
                channel: 'hub-artifact',
                targetVersion: '0.30.7',
                targetCapabilities: ['runner-self-upgrade'],
            })
            expect(offer?.soupTag).toBe(tag)
            expect(offer?.releaseNotes).toContain('#247')
            // Layer A single-exe pets detect as npm (no monorepo). Overlay must
            // still promote tip NOTES onto a hub-artifact offer (#304 follow-up).
            const fromNpm = soupTipToUpgradeOffer(tip!, 'linux', 'x64', {
                channel: 'npm',
                targetVersion: '0.31.5',
                targetCapabilities: ['runner-self-upgrade'],
                npmPackage: '@twsxtd/hapi',
            })
            expect(fromNpm?.channel).toBe('hub-artifact')
            expect(fromNpm?.releaseNotes).toContain('#247')
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

    it('Layer A (HAPI_UPSTREAM_SEAL_URL): prefers fleet-latest over diverged latest (#304 follow-up)', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-fleet-pref-'))
        const prev = process.env.HAPI_UPSTREAM_SEAL_URL
        try {
            const dogfood = 'hapi-soup-v2026.11.01-dogfood0'
            const sealed = 'hapi-soup-v2026.11.02-sealed01'
            writeTipFixture(root, dogfood, 'dogfood0000001')
            const sealedDir = writeTipFixture(root, sealed, 'sealed00000001')
            writeFileSync(join(sealedDir, 'NOTES.md'), '### Changes\n\n- feat: sealed notes (#304)\n')
            symlinkSync(dogfood, join(root, 'latest'))
            symlinkSync(sealed, join(root, 'fleet-latest'))
            process.env.HAPI_UPSTREAM_SEAL_URL =
                'https://github.com/heavygee/hapi/releases/download/hapi-fleet/manifest.json'

            const tip = readPublishedSoupTip(root)
            expect(tip?.tag).toBe(sealed)
            expect(tip?.releaseNotes).toContain('sealed notes')
        } finally {
            if (prev === undefined) {
                delete process.env.HAPI_UPSTREAM_SEAL_URL
            } else {
                process.env.HAPI_UPSTREAM_SEAL_URL = prev
            }
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('foundry (no seal URL): still prefers latest so dogfood tip wins', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-soup-latest-pref-'))
        const prev = process.env.HAPI_UPSTREAM_SEAL_URL
        try {
            delete process.env.HAPI_UPSTREAM_SEAL_URL
            const dogfood = 'hapi-soup-v2026.11.01-dogfood0'
            const sealed = 'hapi-soup-v2026.11.02-sealed01'
            writeTipFixture(root, dogfood, 'dogfood0000001')
            writeTipFixture(root, sealed, 'sealed00000001')
            symlinkSync(dogfood, join(root, 'latest'))
            symlinkSync(sealed, join(root, 'fleet-latest'))

            const tip = readPublishedSoupTip(root)
            expect(tip?.tag).toBe(dogfood)
        } finally {
            if (prev === undefined) {
                delete process.env.HAPI_UPSTREAM_SEAL_URL
            } else {
                process.env.HAPI_UPSTREAM_SEAL_URL = prev
            }
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

describe('release notes ride inside the manifest (#304 — Ian empty "what\'s new")', () => {
    // Notes used to be a SECOND fetch after manifest.json. That request could
    // 404 on CDN lag or be skipped entirely, and the banner then degraded to
    // "No release notes published for this tip yet" while the software was
    // installed and working. GitHub already solves this — a release holds its
    // body and its assets as one object — so the notes now ship inside the
    // manifest every host already fetches. Artifact availability and notes
    // availability become the same event.
    const writeTip = (dir: string, manifest: Record<string, unknown>, notesFile?: string) => {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
        if (notesFile !== undefined) writeFileSync(join(dir, 'NOTES.md'), notesFile)
    }
    const base = {
        schema: 1,
        tag: 'hapi-soup-v2026.11.12-49f1e53',
        composedTipSha: '49f1e53c8007',
        binaries: [{ platform: 'linux', arch: 'x64', path: 'linux-x64-baseline/hapi', sha256: 'x', sizeBytes: 1 }],
    }

    it('serves notes from the manifest with NO NOTES.md on disk', () => {
        const root = mkdtempSync(join(tmpdir(), 'soup-notes-'))
        const dir = join(root, base.tag)
        // The case that matters: the separate file never arrived.
        writeTip(dir, { ...base, releaseNotes: 'Atomic notes from the manifest.' })
        writeFileSync(join(root, 'latest-tag.txt'), base.tag)
        const tip = readPublishedSoupTip(root, {} as NodeJS.ProcessEnv)
        expect(tip?.releaseNotes).toBe('Atomic notes from the manifest.')
        rmSync(root, { recursive: true, force: true })
    })

    it('prefers the manifest over a stale NOTES.md', () => {
        const root = mkdtempSync(join(tmpdir(), 'soup-notes-'))
        const dir = join(root, base.tag)
        writeTip(dir, { ...base, releaseNotes: 'fresh' }, 'stale from a previous tip')
        writeFileSync(join(root, 'latest-tag.txt'), base.tag)
        expect(readPublishedSoupTip(root, {} as NodeJS.ProcessEnv)?.releaseNotes).toBe('fresh')
        rmSync(root, { recursive: true, force: true })
    })

    it('falls back to NOTES.md for tips published before the field existed', () => {
        const root = mkdtempSync(join(tmpdir(), 'soup-notes-'))
        const dir = join(root, base.tag)
        writeTip(dir, base, 'legacy notes on disk')
        writeFileSync(join(root, 'latest-tag.txt'), base.tag)
        expect(readPublishedSoupTip(root, {} as NodeJS.ProcessEnv)?.releaseNotes).toBe('legacy notes on disk')
        rmSync(root, { recursive: true, force: true })
    })
})
