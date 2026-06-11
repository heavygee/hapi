import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { voicePersonaForSession, applyPersonaOverride } from './voicePersona'
import {
    GEMINI_LIVE_VOICE_OPTIONS,
    QWEN_REALTIME_VOICE_OPTIONS,
    VOICE_PICKER_STORAGE_KEYS,
} from '@hapi/protocol/voicePickerCatalog'

describe('voicePersonaForSession', () => {
    it('returns a Gemini voice for gemini-live backend', () => {
        const persona = voicePersonaForSession('session-abc', 'gemini-live')
        expect(persona).not.toBeNull()
        expect(GEMINI_LIVE_VOICE_OPTIONS.some((v) => v.id === persona!.id)).toBe(true)
    })

    it('returns a Qwen voice for qwen-realtime backend', () => {
        const persona = voicePersonaForSession('session-abc', 'qwen-realtime')
        expect(persona).not.toBeNull()
        expect(QWEN_REALTIME_VOICE_OPTIONS.some((v) => v.id === persona!.id)).toBe(true)
    })

    it('returns null for elevenlabs (dynamic list — not yet handled)', () => {
        expect(voicePersonaForSession('session-abc', 'elevenlabs')).toBeNull()
    })

    it('is deterministic: same sessionId returns the same voice', () => {
        const a = voicePersonaForSession('session-xyz', 'gemini-live')
        const b = voicePersonaForSession('session-xyz', 'gemini-live')
        expect(a!.id).toBe(b!.id)
    })

    it('different sessionIds yield different voices (over a reasonable spread)', () => {
        const ids = new Set<string>()
        for (let i = 0; i < 50; i++) {
            const persona = voicePersonaForSession(`session-${i}`, 'qwen-realtime')!
            ids.add(persona.id)
        }
        // With 6 Qwen voices and 50 ids, expect to see most of the catalog
        expect(ids.size).toBeGreaterThanOrEqual(4)
    })

    it('returns null for empty sessionId', () => {
        expect(voicePersonaForSession('', 'gemini-live')).toBeNull()
    })
})

describe('applyPersonaOverride', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
    })

    it('writes the persona id to the backend storage key', () => {
        const { persona } = applyPersonaOverride('session-abc', 'qwen-realtime')
        expect(persona).not.toBeNull()
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS['qwen-realtime'])).toBe(persona!.id)
    })

    it('restore() returns the storage to its previous value', () => {
        localStorage.setItem(VOICE_PICKER_STORAGE_KEYS['gemini-live'], 'Aoede')
        const { persona, restore } = applyPersonaOverride('session-xyz', 'gemini-live')
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS['gemini-live'])).toBe(persona!.id)
        restore()
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS['gemini-live'])).toBe('Aoede')
    })

    it('restore() clears the key if there was no previous value', () => {
        const { restore } = applyPersonaOverride('session-xyz', 'qwen-realtime')
        restore()
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS['qwen-realtime'])).toBeNull()
    })

    it('is a no-op for elevenlabs', () => {
        localStorage.setItem(VOICE_PICKER_STORAGE_KEYS.elevenlabs, 'eleven-voice-id')
        const { persona, restore } = applyPersonaOverride('session-abc', 'elevenlabs')
        expect(persona).toBeNull()
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS.elevenlabs)).toBe('eleven-voice-id')
        restore()
        expect(localStorage.getItem(VOICE_PICKER_STORAGE_KEYS.elevenlabs)).toBe('eleven-voice-id')
    })
})
