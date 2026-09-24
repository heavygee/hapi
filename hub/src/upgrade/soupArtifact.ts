/**
 * Published soup single-exe as the hub-artifact upgrade source of truth.
 *
 * Estate kill-criterion (heavygee#122): under policy=auto, fleet must converge
 * on `soup-artifacts/latest`, not a parallel `upgrade-artifacts/hapi-<semver>-<fp>`
 * compile of the live monorepo. Ops SCP (`hapi-fleet-runner-upgrade`) already
 * writes `.hapi-upgrade-target` with targetVersion=targetGeneration=<soup-tag>;
 * the hub offer must use the same identity or auto-upgrade stomps the tip.
 */

import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import type { ArtifactMeta } from './cliArtifact'

export type SoupBinaryEntry = {
    target: string
    platform: string
    arch: string
    variant?: string
    path: string
    sha256: string
    sizeBytes: number
}

export type SoupManifest = {
    schema: number
    tag: string
    composedTipSha: string
    binaries: SoupBinaryEntry[]
}

export type PublishedSoupTip = {
    root: string
    tag: string
    composedTipSha: string
    manifestPath: string
    binaries: SoupBinaryEntry[]
}

/** Default publish root on the soup foundry (oos-linux). */
export function defaultSoupArtifactsRoot(): string {
    return process.env.HAPI_SOUP_ARTIFACTS_ROOT
        ?? process.env.HAPI_SOUP_ARTIFACTS
        ?? '/var/lib/hapi/soup-artifacts'
}

/**
 * Prefer published soup tip when present. Set HAPI_UPGRADE_PREFER_SOUP=0 to
 * force the live-tree fingerprint compile path (debug / break-glass).
 */
export function preferPublishedSoupTip(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.HAPI_UPGRADE_PREFER_SOUP
    if (raw == null || raw.trim() === '') {
        return true
    }
    const value = raw.trim().toLowerCase()
    return value !== '0' && value !== 'false' && value !== 'off' && value !== 'no'
}

export function readPublishedSoupTip(
    artifactsRoot: string = defaultSoupArtifactsRoot(),
): PublishedSoupTip | null {
    const latestLink = join(artifactsRoot, 'latest')
    const latestTagFile = join(artifactsRoot, 'latest-tag.txt')
    let tipDir: string | null = null
    if (existsSync(latestLink)) {
        try {
            tipDir = realpathSync(latestLink)
        } catch {
            tipDir = latestLink
        }
    } else if (existsSync(latestTagFile)) {
        const tag = readFileSync(latestTagFile, 'utf8').trim()
        if (tag) {
            tipDir = join(artifactsRoot, tag)
        }
    }
    if (!tipDir || !existsSync(tipDir)) {
        return null
    }
    const manifestPath = join(tipDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
        return null
    }
    try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as SoupManifest
        if (typeof parsed.tag !== 'string' || !parsed.tag.startsWith('hapi-soup-v')) {
            return null
        }
        if (!Array.isArray(parsed.binaries) || parsed.binaries.length === 0) {
            return null
        }
        return {
            root: tipDir,
            tag: parsed.tag,
            composedTipSha: typeof parsed.composedTipSha === 'string' ? parsed.composedTipSha : '',
            manifestPath,
            binaries: parsed.binaries,
        }
    } catch {
        return null
    }
}

/** Map Node platform to soup manifest platform + directory layout. */
export function soupPlatformDir(platform: string, arch: string, variant?: string): string {
    const soupPlatform = platform === 'win32' ? 'windows' : platform
    if (soupPlatform === 'linux' && arch === 'x64') {
        return `linux-x64-${variant && variant.length > 0 ? variant : 'baseline'}`
    }
    return `${soupPlatform}-${arch}${variant ? `-${variant}` : ''}`
}

export function findSoupBinary(
    tip: PublishedSoupTip,
    platform: string,
    arch: string,
): { entry: SoupBinaryEntry; absolutePath: string } | null {
    const soupPlatform = platform === 'win32' ? 'windows' : platform
    const matches = tip.binaries.filter((b) => b.platform === soupPlatform && b.arch === arch)
    if (matches.length === 0) {
        return null
    }
    // Prefer baseline linux x64 (estate fleet default).
    const entry = matches.find((b) => (b.variant ?? '') === 'baseline')
        ?? matches.find((b) => !(b.variant && b.variant.length > 0))
        ?? matches[0]!
    const absolutePath = join(tip.root, entry.path)
    if (!existsSync(absolutePath)) {
        return null
    }
    return { entry, absolutePath }
}

/**
 * Build a hub-artifact offer that tracks the published soup tip.
 * targetVersion and targetGeneration are both the soup tag — same contract as
 * `hapi-fleet-runner-upgrade` durable markers — so semver-skew (tip embeds
 * 0.29.x while stock sits at 0.30.x) cannot stomp the tip via versionBehind.
 */
export function soupTipToUpgradeOffer(
    tip: PublishedSoupTip,
    platform: string = process.platform,
    arch: string = process.arch,
    baseOffer?: HubUpgradeOffer,
): HubUpgradeOffer | null {
    const found = findSoupBinary(tip, platform, arch)
    if (!found) {
        return null
    }
    const { entry } = found
    return {
        channel: 'hub-artifact',
        targetVersion: tip.tag,
        targetGeneration: tip.tag,
        targetCapabilities: baseOffer?.targetCapabilities ?? [],
        artifact: {
            url: `/cli/upgrade/cli-artifact?sha256=${encodeURIComponent(entry.sha256)}`,
            sha256: entry.sha256,
            platform,
            arch,
            sizeBytes: entry.sizeBytes,
        },
    }
}

/** Disk name for the upgrade-artifacts mirror of a soup tip binary. */
export function soupFleetMirrorFileName(tag: string, platform: string, arch: string): string {
    const dir = soupPlatformDir(platform, arch)
    return `${tag}-${dir}`
}

/**
 * Ensure the soup tip binary is retained under upgrade-artifacts (digest-pinned
 * downloads) without compiling a parallel stock stream.
 */
export function ensureSoupCliArtifact(options: {
    tip: PublishedSoupTip
    platform: string
    arch: string
    dataDir: string
}): ArtifactMeta {
    const found = findSoupBinary(options.tip, options.platform, options.arch)
    if (!found) {
        throw new Error(
            `Soup tip ${options.tip.tag} has no binary for ${options.platform}/${options.arch}`,
        )
    }
    const { entry, absolutePath } = found
    const dir = join(options.dataDir, 'upgrade-artifacts')
    mkdirSync(dir, { recursive: true })
    const outName = soupFleetMirrorFileName(options.tip.tag, options.platform, options.arch)
    const outPath = join(dir, outName)
    const metaPath = `${outPath}.json`

    const existing = existsSync(outPath) && existsSync(metaPath)
        ? (() => {
            try {
                return JSON.parse(readFileSync(metaPath, 'utf8')) as ArtifactMeta
            } catch {
                return null
            }
        })()
        : null
    if (
        existing
        && existing.sha256 === entry.sha256
        && existing.sourceFingerprint === options.tip.tag
        && existsSync(outPath)
    ) {
        return existing
    }

    copyFileSync(absolutePath, outPath)
    if (options.platform !== 'win32') {
        try {
            chmodSync(outPath, 0o755)
        } catch {
            // Best-effort; download still works if mode sticks from umask.
        }
    }

    const meta: ArtifactMeta = {
        version: options.tip.tag,
        platform: options.platform,
        arch: options.arch,
        path: outPath,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        sourceFingerprint: options.tip.tag,
    }
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    return meta
}

/** True when this offer is keyed on a published soup tip tag. */
export function isSoupTipOffer(offer: HubUpgradeOffer): boolean {
    return offer.channel === 'hub-artifact'
        && typeof offer.targetVersion === 'string'
        && offer.targetVersion.startsWith('hapi-soup-v')
        && offer.targetGeneration === offer.targetVersion
}
