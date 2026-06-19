import { describe, expect, it } from 'vitest'
import { isSessionVoiceFocus } from './voice'

describe('VoiceFocus', () => {
    it('identifies session focus with ref', () => {
        expect(isSessionVoiceFocus({ kind: 'session', ref: 'abc' })).toBe(true)
        expect(isSessionVoiceFocus({ kind: 'session' })).toBe(false)
        expect(isSessionVoiceFocus({ kind: 'overseer' })).toBe(false)
        expect(isSessionVoiceFocus(null)).toBe(false)
    })
})
