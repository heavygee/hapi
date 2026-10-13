/**
 * Layer A upstream seal — digest-only + ouroboros + materialize.
 * Run: cd hub && bun test src/upgrade/upstreamSeal.test.ts
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    assertUpstreamSealUrlSafe,
    decideUpstreamSealNewness,
    ghAssetNameForBinaryPath,
    resolveBinaryDownloadUrl,
    resolveUpstreamSealConfig,
    runUpstreamSealTick,
    type UpstreamSealConfig,
} from './upstreamSeal'
import type { SoupManifest } from './soupArtifact'

const tipSha = 'a'.repeat(64)
const diskSha = 'b'.repeat(64)

const manifest: SoupManifest = {
    schema: 1,
    tag: 'hapi-soup-v2026.10.13-deadbeef',
    composedTipSha: 'deadbeef',
    binaries: [
        {
            target: 'bun-linux-x64-baseline',
            platform: 'linux',
            arch: 'x64',
            variant: 'baseline',
            path: 'linux-x64-baseline/hapi',
            sha256: tipSha,
            sizeBytes: 12,
        },
    ],
}

describe('resolveUpstreamSealConfig', () => {
    it('returns null when unset', () => {
        expect(resolveUpstreamSealConfig({})).toBeNull()
    })

    it('builds GH manifest URL from named seal tag', () => {
        const cfg = resolveUpstreamSealConfig({
            HAPI_UPSTREAM_SEAL_TAG: 'hapi-soup-v2026.10.13-bc936f2',
        })
        expect(cfg?.manifestUrl).toContain(
            'releases/download/hapi-soup-v2026.10.13-bc936f2/manifest.json',
        )
    })

    it('prefers explicit URL over tag', () => {
        const cfg = resolveUpstreamSealConfig({
            HAPI_UPSTREAM_SEAL_URL: 'https://artifacts.example/fleet-latest/manifest.json',
            HAPI_UPSTREAM_SEAL_TAG: 'hapi-soup-v2026.10.13-bc936f2',
        })
        expect(cfg?.manifestUrl).toBe('https://artifacts.example/fleet-latest/manifest.json')
    })
})

describe('assertUpstreamSealUrlSafe', () => {
    it('refuses file: under local artifacts root', () => {
        expect(() =>
            assertUpstreamSealUrlSafe('file:///var/lib/hapi/soup-artifacts/fleet-latest/manifest.json', {
                artifactsRoot: '/var/lib/hapi/soup-artifacts',
            }),
        ).toThrow(/ouroboros/)
    })

    it('allows remote https', () => {
        expect(() =>
            assertUpstreamSealUrlSafe('https://oos.example/soup-artifacts/fleet-latest/manifest.json', {
                artifactsRoot: '/var/lib/hapi/soup-artifacts',
                publicUrl: 'https://ninja.example',
            }),
        ).not.toThrow()
    })

    it('refuses same-host public URL soup path', () => {
        expect(() =>
            assertUpstreamSealUrlSafe('https://hub.example/soup-artifacts/fleet-latest/manifest.json', {
                artifactsRoot: '/var/lib/hapi/soup-artifacts',
                publicUrl: 'https://hub.example',
            }),
        ).toThrow(/ouroboros/)
    })
})

describe('decideUpstreamSealNewness', () => {
    it('is new when digests differ', () => {
        const d = decideUpstreamSealNewness({
            manifest,
            platform: 'linux',
            arch: 'x64',
            onDiskSha256: diskSha,
        })
        expect(d.action).toBe('new')
        expect(d.remoteSha256).toBe(tipSha)
    })

    it('is current when digests match even if tags differ', () => {
        const d = decideUpstreamSealNewness({
            manifest: { ...manifest, tag: 'hapi-soup-v2099.01.01-fffff' },
            platform: 'linux',
            arch: 'x64',
            onDiskSha256: tipSha,
        })
        expect(d.action).toBe('current')
    })

    it('fails closed on bad schema', () => {
        const d = decideUpstreamSealNewness({
            manifest: { ...manifest, schema: 99 },
            platform: 'linux',
            arch: 'x64',
            onDiskSha256: tipSha,
        })
        expect(d.action).toBe('error')
    })
})

describe('gh / binary URL mapping', () => {
    it('maps linux baseline path to GH asset', () => {
        expect(ghAssetNameForBinaryPath('linux-x64-baseline/hapi')).toBe('hapi-linux-x64-baseline')
    })

    it('rewrites GH release download URL to asset name', () => {
        const url = resolveBinaryDownloadUrl(
            'https://github.com/heavygee/hapi/releases/download/hapi-soup-v1/manifest.json',
            manifest.binaries[0]!,
        )
        expect(url).toContain('/hapi-linux-x64-baseline')
        expect(url).not.toContain('manifest.json')
    })

    it('uses tip-relative path for HTTP mirrors', () => {
        const url = resolveBinaryDownloadUrl(
            'https://artifacts.example/fleet-latest/manifest.json',
            manifest.binaries[0]!,
        )
        expect(url).toBe('https://artifacts.example/fleet-latest/linux-x64-baseline/hapi')
    })
})

describe('runUpstreamSealTick', () => {
    let root = ''

    afterEach(() => {
        if (root) {
            rmSync(root, { recursive: true, force: true })
            root = ''
        }
    })

    it('materializes when digest-new', async () => {
        root = mkdtempSync(join(tmpdir(), 'upstream-seal-'))
        const bytes = Buffer.from('seal-payload-xyz')
        const sha = createHash('sha256').update(bytes).digest('hex')
        const m: SoupManifest = {
            schema: 1,
            tag: 'hapi-soup-v2026.10.13-ticktest',
            composedTipSha: 'tick',
            binaries: [
                {
                    target: 'bun-linux-x64-baseline',
                    platform: 'linux',
                    arch: 'x64',
                    variant: 'baseline',
                    path: 'linux-x64-baseline/hapi',
                    sha256: sha,
                    sizeBytes: bytes.length,
                },
            ],
        }

        const oldTag = 'hapi-soup-v2026.10.13-oldold'
        const oldDir = join(root, oldTag, 'linux-x64-baseline')
        mkdirSync(oldDir, { recursive: true })
        writeFileSync(join(oldDir, 'hapi'), 'old-bytes')
        writeFileSync(
            join(root, oldTag, 'manifest.json'),
            JSON.stringify({
                schema: 1,
                tag: oldTag,
                composedTipSha: 'old',
                binaries: [
                    {
                        target: 'bun-linux-x64-baseline',
                        platform: 'linux',
                        arch: 'x64',
                        variant: 'baseline',
                        path: 'linux-x64-baseline/hapi',
                        sha256: 'c'.repeat(64),
                        sizeBytes: 9,
                    },
                ],
            }),
        )
        symlinkSync(oldTag, join(root, 'latest'))
        writeFileSync(join(root, 'latest-tag.txt'), `${oldTag}\n`)

        const config: UpstreamSealConfig = {
            manifestUrl: 'https://example.test/fleet-latest/manifest.json',
            pollIntervalMs: 60_000,
            artifactsRoot: root,
            platform: 'linux',
            arch: 'x64',
            publicUrl: null,
            apply: true,
        }

        const tick = await runUpstreamSealTick({
            config,
            fetchManifest: async () => m,
            materialize: async (opts) => {
                const tipDir = join(opts.artifactsRoot, opts.manifest.tag)
                mkdirSync(join(tipDir, 'linux-x64-baseline'), { recursive: true })
                writeFileSync(join(tipDir, 'manifest.json'), JSON.stringify(opts.manifest))
                writeFileSync(join(tipDir, opts.binary.path), bytes)
                const got = createHash('sha256').update(bytes).digest('hex')
                if (got !== opts.binary.sha256) throw new Error('digest mismatch')
                for (const name of ['latest', 'fleet-latest']) {
                    try {
                        rmSync(join(opts.artifactsRoot, name), { force: true })
                    } catch {
                        /* */
                    }
                    symlinkSync(opts.manifest.tag, join(opts.artifactsRoot, name))
                }
                writeFileSync(join(opts.artifactsRoot, 'latest-tag.txt'), `${opts.manifest.tag}\n`)
                writeFileSync(join(opts.artifactsRoot, 'fleet-latest-tag.txt'), `${opts.manifest.tag}\n`)
                return { tipDir, onDiskSha256: got }
            },
        })

        expect(tick.action).toBe('new')
        expect(tick.materialized).toBe(true)
        expect(readFileSync(join(root, 'fleet-latest-tag.txt'), 'utf8').trim()).toBe(
            'hapi-soup-v2026.10.13-ticktest',
        )
    })

    it('holds materialize when apply=false', async () => {
        root = mkdtempSync(join(tmpdir(), 'upstream-seal-hold-'))
        const config: UpstreamSealConfig = {
            manifestUrl: 'https://example.test/fleet-latest/manifest.json',
            pollIntervalMs: 60_000,
            artifactsRoot: root,
            platform: 'linux',
            arch: 'x64',
            publicUrl: null,
            apply: false,
        }
        const tick = await runUpstreamSealTick({
            config,
            fetchManifest: async () => manifest,
            materialize: async () => {
                throw new Error('must not materialize')
            },
        })
        expect(tick.action).toBe('new')
        expect(tick.materialized).toBe(false)
        expect(tick.reason).toMatch(/apply disabled/i)
    })
})
