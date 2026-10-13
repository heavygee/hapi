/**
 * Layer A: hub-native upstream fleet-seal discover + materialize.
 *
 * **FORK-ONLY (`heavygee/hapi` soup).** Not for `tiann/hapi`. @tiann rejected
 * this class of hub-artifact / auto-upgrade machinery upstream (PR #1108,
 * 2026-08-02) — chicken-egg skew, capability-gap reinstall loops, maintenance
 * burden. Closed door; do not structure this as upstream-PR-bound.
 *
 * Canon: docs/plans/2026-10-13-fleet-seal-contract.md
 *
 * Config: HAPI_UPSTREAM_SEAL_URL (manifest) and/or HAPI_UPSTREAM_SEAL_TAG
 * (GH named seal → …/releases/download/<tag>/manifest.json).
 * Digest-only newness → local soup-artifacts materialize → existing offer/#251.
 *
 * Not Layer B. Not a companion process. Foundry (oos) leaves URL unset.
 */

import { createHash } from 'node:crypto'
import {
    chmodSync,
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
    defaultSoupArtifactsRoot,
    findSoupBinary,
    readPublishedSoupTip,
    type SoupBinaryEntry,
    type SoupManifest,
} from './soupArtifact'

const SUPPORTED_SCHEMA = 1
const DEFAULT_GH_REPO = 'heavygee/hapi'

export type UpstreamSealConfig = {
    manifestUrl: string
    pollIntervalMs: number
    artifactsRoot: string
    platform: string
    arch: string
    publicUrl: string | null
    /** When false, digest-new only logs — no materialize (HAPI_UPSTREAM_SEAL_APPLY=0). */
    apply: boolean
}

export type UpstreamSealCheckResult = {
    action: 'hold' | 'current' | 'new' | 'error'
    reason: string
    tag?: string
    remoteSha256?: string
    materialized?: boolean
}

export type UpstreamSealSubscriber = {
    stop: () => void
}

/** Map on-disk binaries[].path → GitHub release asset name. */
export function ghAssetNameForBinaryPath(path: string): string {
    const p = path.replace(/^\.\//, '')
    if (p === 'linux-x64-baseline/hapi') return 'hapi-linux-x64-baseline'
    if (p === 'linux-arm64/hapi') return 'hapi-linux-arm64'
    if (p === 'darwin-arm64/hapi') return 'hapi-darwin-arm64'
    if (p === 'darwin-x64/hapi') return 'hapi-darwin-x64'
    if (p === 'windows-x64/hapi.exe') return 'hapi-windows-x64.exe'
    return `hapi-${p.split('/')[0]}`
}

export function resolveUpstreamSealPollMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.HAPI_UPSTREAM_SEAL_POLL_MS?.trim()
    if (!raw) return 60_000
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 5_000) return 60_000
    return Math.floor(n)
}

/**
 * Resolve Layer A config. Returns null when unset (foundry / hubs that are SoT only).
 * Prefer explicit HAPI_UPSTREAM_SEAL_URL; else named GH tag via HAPI_UPSTREAM_SEAL_TAG.
 */
export function resolveUpstreamSealConfig(
    env: NodeJS.ProcessEnv = process.env,
    _options: { execPath?: string } = {},
): UpstreamSealConfig | null {
    const explicit = env.HAPI_UPSTREAM_SEAL_URL?.trim()
    const tag = env.HAPI_UPSTREAM_SEAL_TAG?.trim()
    const repo = env.HAPI_UPSTREAM_SEAL_REPO?.trim() || DEFAULT_GH_REPO

    let manifestUrl: string | null = null
    if (explicit) {
        manifestUrl = explicit
    } else if (tag) {
        if (!tag.startsWith('hapi-soup-v')) {
            console.warn('[upstream-seal] HAPI_UPSTREAM_SEAL_TAG must be hapi-soup-v*; ignoring')
            return null
        }
        manifestUrl =
            `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/manifest.json`
    }
    if (!manifestUrl) {
        return null
    }

    const applyRaw = (env.HAPI_UPSTREAM_SEAL_APPLY ?? '1').trim().toLowerCase()
    const apply = !(applyRaw === '0' || applyRaw === 'false' || applyRaw === 'off' || applyRaw === 'no')

    const artifactsRoot = defaultSoupArtifactsRoot()
    const publicUrl = env.HAPI_PUBLIC_URL?.trim() || null

    try {
        assertUpstreamSealUrlSafe(manifestUrl, { artifactsRoot, publicUrl })
    } catch (err) {
        console.warn(
            `[upstream-seal] disabled: ${err instanceof Error ? err.message : String(err)}`,
        )
        return null
    }

    return {
        manifestUrl,
        pollIntervalMs: resolveUpstreamSealPollMs(env),
        artifactsRoot,
        platform: process.platform,
        arch: process.arch,
        publicUrl,
        apply,
    }
}

/**
 * Refuse ouroboros: upstream URL must not be this hub's own artifacts tree.
 */
export function assertUpstreamSealUrlSafe(
    url: string,
    options: { artifactsRoot: string; publicUrl?: string | null },
): void {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new Error(`HAPI_UPSTREAM_SEAL_URL is not a valid URL: ${url}`)
    }

    if (parsed.protocol === 'file:') {
        const path = decodeURIComponent(parsed.pathname)
        const root = options.artifactsRoot.replace(/\/+$/, '')
        if (path === root || path.startsWith(`${root}/`)) {
            throw new Error(
                'HAPI_UPSTREAM_SEAL_URL must not point at this hub\'s own soup-artifacts (ouroboros)',
            )
        }
        return
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`HAPI_UPSTREAM_SEAL_URL unsupported protocol: ${parsed.protocol}`)
    }

    const publicUrl = options.publicUrl?.trim()
    if (publicUrl) {
        try {
            const pub = new URL(publicUrl)
            if (
                parsed.hostname === pub.hostname
                && parsed.port === pub.port
                && /soup-artifacts|fleet-latest/i.test(parsed.pathname)
            ) {
                throw new Error(
                    'HAPI_UPSTREAM_SEAL_URL must not point at this hub\'s own public URL soup tree (ouroboros)',
                )
            }
        } catch (err) {
            if (err instanceof Error && /ouroboros/.test(err.message)) {
                throw err
            }
        }
    }
}

export function assertManifestSchema(manifest: unknown): SoupManifest {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('upstream seal manifest missing or not an object')
    }
    const m = manifest as Record<string, unknown>
    if (typeof m.schema !== 'number' || m.schema !== SUPPORTED_SCHEMA) {
        throw new Error(`unsupported upstream seal manifest.schema (want ${SUPPORTED_SCHEMA})`)
    }
    if (typeof m.tag !== 'string' || !m.tag.startsWith('hapi-soup-v')) {
        throw new Error('upstream seal manifest.tag missing or not hapi-soup-v*')
    }
    if (!Array.isArray(m.binaries) || m.binaries.length === 0) {
        throw new Error('upstream seal manifest.binaries empty')
    }
    return m as unknown as SoupManifest
}

export async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
}

export function pickPlatformBinary(
    manifest: SoupManifest,
    platform: string,
    arch: string,
): SoupBinaryEntry | null {
    const soupPlatform = platform === 'win32' ? 'windows' : platform
    const matches = manifest.binaries.filter((b) => b.platform === soupPlatform && b.arch === arch)
    if (matches.length === 0) return null
    return matches.find((b) => (b.variant ?? '') === 'baseline')
        ?? matches.find((b) => !(b.variant && b.variant.length > 0))
        ?? matches[0]!
}

export function resolveBinaryDownloadUrl(manifestUrl: string, entry: SoupBinaryEntry): string {
    const base = new URL(manifestUrl)
    if (base.hostname === 'github.com' && /\/releases\/download\//.test(base.pathname)) {
        const asset = ghAssetNameForBinaryPath(entry.path)
        const parts = base.pathname.split('/')
        parts[parts.length - 1] = asset
        base.pathname = parts.join('/')
        return base.toString()
    }
    const dir = dirname(base.pathname)
    const rel = entry.path.replace(/^\.\//, '')
    base.pathname = `${dir}/${rel}`.replace(/\/{2,}/g, '/')
    return base.toString()
}

export function decideUpstreamSealNewness(options: {
    manifest: SoupManifest
    platform: string
    arch: string
    onDiskSha256: string | null
}): UpstreamSealCheckResult & { binary?: SoupBinaryEntry } {
    let manifest: SoupManifest
    try {
        manifest = assertManifestSchema(options.manifest)
    } catch (err) {
        return { action: 'error', reason: err instanceof Error ? err.message : String(err) }
    }

    const bin = pickPlatformBinary(manifest, options.platform, options.arch)
    if (!bin?.sha256) {
        return {
            action: 'error',
            reason: `no seal binary for platform ${options.platform}/${options.arch}`,
        }
    }

    const sealSha = bin.sha256.toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sealSha)) {
        return { action: 'error', reason: 'seal sha256 malformed' }
    }

    const disk = (options.onDiskSha256 ?? '').toLowerCase()
    if (!disk) {
        return {
            action: 'new',
            reason: 'no local staged binary — materialize seal tip',
            tag: manifest.tag,
            remoteSha256: sealSha,
            binary: bin,
        }
    }
    if (!/^[0-9a-f]{64}$/.test(disk)) {
        return { action: 'error', reason: 'on-disk sha256 malformed' }
    }
    if (sealSha === disk) {
        return {
            action: 'current',
            reason: 'digest match — tag/date/NOTES ignored (stale-tag class)',
            tag: manifest.tag,
            remoteSha256: sealSha,
        }
    }
    return {
        action: 'new',
        reason: 'platform binary sha256 differs from local staged bytes',
        tag: manifest.tag,
        remoteSha256: sealSha,
        binary: bin,
    }
}

export async function fetchUpstreamManifest(url: string): Promise<SoupManifest> {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'hapi-hub-upstream-seal' },
        redirect: 'follow',
    })
    if (!res.ok) {
        throw new Error(`upstream seal manifest fetch failed: HTTP ${res.status}`)
    }
    return assertManifestSchema(await res.json())
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
    mkdirSync(dirname(destPath), { recursive: true })
    const res = await fetch(url, {
        headers: { 'User-Agent': 'hapi-hub-upstream-seal' },
        redirect: 'follow',
    })
    if (!res.ok || !res.body) {
        throw new Error(`upstream binary download failed: HTTP ${res.status} ${url}`)
    }
    const tmp = `${destPath}.partial`
    const nodeBody = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    await pipeline(nodeBody, createWriteStream(tmp))
    renameSync(tmp, destPath)
}

export async function materializeUpstreamSeal(options: {
    manifestUrl: string
    manifest: SoupManifest
    binary: SoupBinaryEntry
    artifactsRoot: string
}): Promise<{ tipDir: string; onDiskSha256: string }> {
    const tag = options.manifest.tag
    const tipDir = join(options.artifactsRoot, tag)
    mkdirSync(tipDir, { recursive: true })
    writeFileSync(join(tipDir, 'manifest.json'), `${JSON.stringify(options.manifest, null, 2)}\n`)

    try {
        const notesUrl = new URL(options.manifestUrl)
        if (notesUrl.hostname === 'github.com' && /\/releases\/download\//.test(notesUrl.pathname)) {
            const parts = notesUrl.pathname.split('/')
            parts[parts.length - 1] = 'NOTES.md'
            notesUrl.pathname = parts.join('/')
        } else {
            notesUrl.pathname = `${dirname(notesUrl.pathname)}/NOTES.md`.replace(/\/{2,}/g, '/')
        }
        await downloadToFile(notesUrl.toString(), join(tipDir, 'NOTES.md'))
    } catch {
        // optional
    }

    const destBinary = join(tipDir, options.binary.path)
    const downloadUrl = resolveBinaryDownloadUrl(options.manifestUrl, options.binary)
    await downloadToFile(downloadUrl, destBinary)
    try {
        chmodSync(destBinary, 0o755)
    } catch {
        // best-effort
    }

    const got = await sha256File(destBinary)
    if (got.toLowerCase() !== options.binary.sha256.toLowerCase()) {
        rmSync(destBinary, { force: true })
        throw new Error(
            `digest mismatch after download: got ${got} want ${options.binary.sha256} (refuse apply)`,
        )
    }

    for (const name of ['latest', 'fleet-latest']) {
        const link = join(options.artifactsRoot, name)
        try {
            rmSync(link, { force: true })
        } catch {
            // ignore
        }
        symlinkSync(tag, link)
    }
    writeFileSync(join(options.artifactsRoot, 'latest-tag.txt'), `${tag}\n`)
    writeFileSync(join(options.artifactsRoot, 'fleet-latest-tag.txt'), `${tag}\n`)

    return { tipDir, onDiskSha256: got }
}

export function readLocalPlatformSha256(
    artifactsRoot: string,
    platform: string,
    arch: string,
): string | null {
    const tip = readPublishedSoupTip(artifactsRoot)
    if (!tip) return null
    const found = findSoupBinary(tip, platform, arch)
    if (!found) return null
    try {
        return createHash('sha256').update(readFileSync(found.absolutePath)).digest('hex')
    } catch {
        return null
    }
}

export async function runUpstreamSealTick(options: {
    config: UpstreamSealConfig
    fetchManifest?: (url: string) => Promise<SoupManifest>
    materialize?: typeof materializeUpstreamSeal
}): Promise<UpstreamSealCheckResult> {
    const { config } = options
    const fetchManifest = options.fetchManifest ?? fetchUpstreamManifest
    const materialize = options.materialize ?? materializeUpstreamSeal

    const manifest = await fetchManifest(config.manifestUrl)
    const onDiskSha256 = readLocalPlatformSha256(
        config.artifactsRoot,
        config.platform,
        config.arch,
    )
    const decision = decideUpstreamSealNewness({
        manifest,
        platform: config.platform,
        arch: config.arch,
        onDiskSha256,
    })

    if (decision.action !== 'new' || !decision.binary) {
        return {
            action: decision.action,
            reason: decision.reason,
            tag: decision.tag,
            remoteSha256: decision.remoteSha256,
            materialized: false,
        }
    }

    if (!config.apply) {
        return {
            action: 'new',
            reason: `${decision.reason} (apply disabled via HAPI_UPSTREAM_SEAL_APPLY=0)`,
            tag: decision.tag,
            remoteSha256: decision.remoteSha256,
            materialized: false,
        }
    }

    await materialize({
        manifestUrl: config.manifestUrl,
        manifest,
        binary: decision.binary,
        artifactsRoot: config.artifactsRoot,
    })

    return {
        action: 'new',
        reason: decision.reason,
        tag: decision.tag,
        remoteSha256: decision.remoteSha256,
        materialized: true,
    }
}

export function startUpstreamSealSubscriber(options: {
    config: UpstreamSealConfig
    invalidateOfferCache?: () => void
    onResult?: (result: UpstreamSealCheckResult) => void
    onError?: (error: unknown) => void
}): UpstreamSealSubscriber {
    let stopped = false
    let inFlight = false

    const tick = async () => {
        if (stopped || inFlight) return
        inFlight = true
        try {
            const result = await runUpstreamSealTick({ config: options.config })
            options.onResult?.(result)
            if (result.materialized) {
                options.invalidateOfferCache?.()
            }
        } catch (err) {
            options.onError?.(err)
        } finally {
            inFlight = false
        }
    }

    void tick()
    const handle = setInterval(() => {
        void tick()
    }, options.config.pollIntervalMs)

    return {
        stop: () => {
            stopped = true
            clearInterval(handle)
        },
    }
}
