/**
 * Platform/arch normalization for fleet upgrade offers (HTTP query, cache keys,
 * runner artifact guard). win32 and windows are treated as equivalent.
 */
export function normalizeUpgradeOfferPlatform(platform: string | undefined | null): string {
    if (!platform || platform.trim().length === 0) {
        return process.platform
    }
    const normalized = platform.trim().toLowerCase()
    if (normalized === 'windows') {
        return 'win32'
    }
    return normalized
}

export function normalizeUpgradeOfferArch(arch: string | undefined | null): string {
    if (!arch || arch.trim().length === 0) {
        return process.arch
    }
    return arch.trim().toLowerCase()
}

export function upgradeOfferCacheKey(platform: string, arch: string): string {
    return `${normalizeUpgradeOfferPlatform(platform)}/${normalizeUpgradeOfferArch(arch)}`
}

export function parseUpgradeOfferQuery(
    platformParam: string | undefined,
    archParam: string | undefined,
): { platform: string; arch: string } {
    return {
        platform: platformParam === undefined
            ? process.platform
            : normalizeUpgradeOfferPlatform(platformParam),
        arch: archParam === undefined
            ? process.arch
            : normalizeUpgradeOfferArch(archParam),
    }
}
