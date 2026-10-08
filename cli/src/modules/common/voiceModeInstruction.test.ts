import { afterEach, describe, expect, it } from 'vitest'
import {
    applyVoiceModePreference,
    buildVoiceModeInstruction,
    isVoiceModeEnabled,
    resetVoiceModeForTests,
    voiceModeInstructionOrEmpty,
    withVoiceModeInstruction
} from './voiceModeInstruction'

describe('voiceModeInstruction', () => {
    afterEach(() => {
        resetVoiceModeForTests()
    })

    it('is disabled by default', () => {
        expect(isVoiceModeEnabled()).toBe(false)
        expect(voiceModeInstructionOrEmpty()).toBe('')
    })

    it('enables when applied from session bootstrap', () => {
        applyVoiceModePreference(true)
        expect(isVoiceModeEnabled()).toBe(true)
        expect(voiceModeInstructionOrEmpty()).not.toBe('')

        applyVoiceModePreference(false)
        expect(isVoiceModeEnabled()).toBe(false)
        expect(voiceModeInstructionOrEmpty()).toBe('')
    })

    it('builds a short, behavioral instruction — no markdown-ban checklist', () => {
        const body = buildVoiceModeInstruction()
        expect(body.toLowerCase()).toContain('one or two short sentences')
        expect(body.toLowerCase()).toContain('one question')
        expect(body.split('\n').length).toBeLessThan(10)
    })

    it('appends to an existing base prompt when enabled', () => {
        applyVoiceModePreference(true)
        const out = withVoiceModeInstruction('Be helpful.')
        expect(out.startsWith('Be helpful.')).toBe(true)
        expect(out).toContain('Voice mode:')
    })

    it('leaves base unchanged when disabled', () => {
        expect(withVoiceModeInstruction('Be helpful.')).toBe('Be helpful.')
    })
})
