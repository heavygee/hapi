import { describe, expect, it } from 'bun:test'
import {
    normalizeUpgradeOfferPlatform,
    parseUpgradeOfferQuery,
    upgradeOfferCacheKey,
} from './upgradeOfferPlatform'

describe('upgradeOfferPlatform', () => {
    it('normalizes windows to win32 for cache keys', () => {
        expect(normalizeUpgradeOfferPlatform('windows')).toBe('win32')
        expect(upgradeOfferCacheKey('windows', 'x64')).toBe('win32/x64')
    })

    it('parseUpgradeOfferQuery honors explicit platform/arch', () => {
        const parsed = parseUpgradeOfferQuery('win32', 'x64')
        expect(parsed.platform).toBe('win32')
        expect(parsed.arch).toBe('x64')
    })
})
