import { inferMachineArch } from '@hapi/protocol/upgradeChannel'
import type { PublishedSoupTip } from './soupArtifact'

/**
 * Node/process.platform tokens the fleet speak. Soup manifests use `windows`
 * for win32 binaries — normalize both directions at the HTTP boundary.
 */
export function normalizeOfferPlatform(raw: string | null | undefined): string | null {
    if (raw == null) {
        return null
    }
    const value = raw.trim().toLowerCase()
    if (!value) {
        return null
    }
    if (value === 'windows' || value === 'win' || value === 'win32') {
        return 'win32'
    }
    if (value === 'darwin' || value === 'macos' || value === 'osx') {
        return 'darwin'
    }
    if (value === 'linux') {
        return 'linux'
    }
    return value
}

export function normalizeOfferArch(raw: string | null | undefined): string | null {
    if (raw == null) {
        return null
    }
    const value = raw.trim().toLowerCase()
    if (!value) {
        return null
    }
    if (value === 'x86_64' || value === 'amd64') {
        return 'x64'
    }
    if (value === 'aarch64' || value === 'arm64') {
        return 'arm64'
    }
    return value
}

/**
 * Resolve platform/arch for an upgrade offer request.
 * Query beats headers; either beats hub process defaults.
 */
export function resolveOfferPlatformArch(input: {
    queryPlatform?: string | null
    queryArch?: string | null
    headerPlatform?: string | null
    headerArch?: string | null
    fallbackPlatform?: string
    fallbackArch?: string
}): { platform: string; arch: string; fromRequest: boolean } {
    const fallbackPlatform = input.fallbackPlatform ?? process.platform
    const fallbackArch = input.fallbackArch ?? process.arch
    const platform = normalizeOfferPlatform(input.queryPlatform)
        ?? normalizeOfferPlatform(input.headerPlatform)
        ?? fallbackPlatform
    const archFromRequest = normalizeOfferArch(input.queryArch)
        ?? normalizeOfferArch(input.headerArch)
    const fromRequest = Boolean(
        normalizeOfferPlatform(input.queryPlatform)
        ?? normalizeOfferPlatform(input.headerPlatform)
        ?? normalizeOfferArch(input.queryArch)
        ?? normalizeOfferArch(input.headerArch),
    )
    const arch = archFromRequest
        ?? (fromRequest ? (inferMachineArch(platform) ?? fallbackArch) : fallbackArch)
    return { platform, arch, fromRequest }
}

/** Node-facing platform/arch pairs published on the soup tip (windows → win32). */
export function listSoupAvailablePlatforms(
    tip: PublishedSoupTip,
): Array<{ platform: string; arch: string }> {
    const seen = new Set<string>()
    const out: Array<{ platform: string; arch: string }> = []
    for (const entry of tip.binaries) {
        const platform = normalizeOfferPlatform(entry.platform) ?? entry.platform
        const arch = normalizeOfferArch(entry.arch) ?? entry.arch
        const key = `${platform}/${arch}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        out.push({ platform, arch })
    }
    return out
}

export function soupTipHasPlatform(
    tip: PublishedSoupTip,
    platform: string,
    arch: string,
): boolean {
    const wantPlatform = normalizeOfferPlatform(platform) ?? platform
    const wantArch = normalizeOfferArch(arch) ?? arch
    return listSoupAvailablePlatforms(tip).some(
        (entry) => entry.platform === wantPlatform && entry.arch === wantArch,
    )
}
