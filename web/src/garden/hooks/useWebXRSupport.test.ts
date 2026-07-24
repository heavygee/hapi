import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkGardenXrAvailable } from '@/garden/hooks/useWebXRSupport'
import { isQuestBrowser } from '@/garden/utils/questBrowser'

const QUEST_UA =
    'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/39.2.0.0.56.754450099 Chrome/136.0.7103.177 VR Safari/537.36'

const ANDROID_PHONE_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

describe('isQuestBrowser', () => {
    it('detects OculusBrowser user agents', () => {
        expect(isQuestBrowser(QUEST_UA)).toBe(true)
    })

    it('rejects regular Android Chrome', () => {
        expect(isQuestBrowser(ANDROID_PHONE_UA)).toBe(false)
    })
})

describe('checkGardenXrAvailable', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns false on phone Chrome even when immersive-vr is supported', async () => {
        vi.stubGlobal('navigator', {
            userAgent: ANDROID_PHONE_UA,
            xr: {
                isSessionSupported: vi.fn(async () => true),
            },
        })

        await expect(checkGardenXrAvailable(ANDROID_PHONE_UA)).resolves.toBe(false)
    })

    it('returns true on Quest when immersive-vr is supported', async () => {
        vi.stubGlobal('navigator', {
            userAgent: QUEST_UA,
            xr: {
                isSessionSupported: vi.fn(async () => true),
            },
        })

        await expect(checkGardenXrAvailable(QUEST_UA)).resolves.toBe(true)
    })

    it('returns false on Quest when immersive-vr is unavailable', async () => {
        vi.stubGlobal('navigator', {
            userAgent: QUEST_UA,
            xr: {
                isSessionSupported: vi.fn(async () => false),
            },
        })

        await expect(checkGardenXrAvailable(QUEST_UA)).resolves.toBe(false)
    })
})
