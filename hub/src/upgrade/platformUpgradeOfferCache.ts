import { upgradeOfferCacheKey } from './upgradeOfferPlatform'

export type CachedUpgradeOfferEntry<T> = {
    at: number
    offer: T
}

/**
 * TTL cache keyed by normalized platform/arch so a prepared Windows offer cannot
 * poison the hub-process (linux) default slot.
 */
export class PlatformUpgradeOfferCache<T> {
    private readonly entries = new Map<string, CachedUpgradeOfferEntry<T>>()

    constructor(private readonly ttlMs: number) {}

    get(platform: string, arch: string, now = Date.now()): T | null {
        const key = upgradeOfferCacheKey(platform, arch)
        const cached = this.entries.get(key)
        if (!cached || now - cached.at >= this.ttlMs) {
            return null
        }
        return cached.offer
    }

    set(platform: string, arch: string, offer: T, now = Date.now()): void {
        const key = upgradeOfferCacheKey(platform, arch)
        this.entries.set(key, { at: now, offer })
    }

    clear(): void {
        this.entries.clear()
    }
}
