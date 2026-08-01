import { describe, expect, it } from 'vitest'
import { getOverseerBackTarget, getSettingsBackTarget } from './useAppGoBack'

describe('getOverseerBackTarget', () => {
    it('maps /overseer to /sessions for bookmark/PWA entry with no history', () => {
        expect(getOverseerBackTarget('/overseer')).toBe('/sessions')
        expect(getOverseerBackTarget('/sessions')).toBeNull()
    })
})

describe('getSettingsBackTarget', () => {
    it.each([
        ['/settings', '/sessions'],
        ['/settings/general', '/settings'],
        ['/settings/display', '/settings'],
        ['/settings/voice', '/settings'],
        ['/settings/voice/voices', '/settings/voice'],
        ['/settings/voice/advanced', '/settings/voice'],
        ['/sessions', null],
    ])('maps %s to %s', (pathname, target) => {
        expect(getSettingsBackTarget(pathname)).toBe(target)
    })
})
