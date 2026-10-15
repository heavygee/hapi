import { describe, expect, it } from 'bun:test'
import { PlatformUpgradeOfferCache } from './platformUpgradeOfferCache'

describe('PlatformUpgradeOfferCache', () => {
    it('isolates entries by platform/arch', () => {
        const cache = new PlatformUpgradeOfferCache<{ id: string }>(30_000)
        cache.set('linux', 'x64', { id: 'linux-offer' }, 1_000)
        cache.set('win32', 'x64', { id: 'win-offer' }, 1_000)

        expect(cache.get('linux', 'x64', 2_000)?.id).toBe('linux-offer')
        expect(cache.get('win32', 'x64', 2_000)?.id).toBe('win-offer')
        expect(cache.get('windows', 'x64', 2_000)?.id).toBe('win-offer')
    })

    it('expires stale entries', () => {
        const cache = new PlatformUpgradeOfferCache<string>(1_000)
        cache.set('linux', 'x64', 'fresh', 0)
        expect(cache.get('linux', 'x64', 500)).toBe('fresh')
        expect(cache.get('linux', 'x64', 1_500)).toBeNull()
    })

    it('clear removes all platform slots', () => {
        const cache = new PlatformUpgradeOfferCache<string>(30_000)
        cache.set('linux', 'x64', 'a')
        cache.set('win32', 'x64', 'b')
        cache.clear()
        expect(cache.get('linux', 'x64')).toBeNull()
        expect(cache.get('win32', 'x64')).toBeNull()
    })
})
