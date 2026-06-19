import { describe, expect, test } from 'bun:test'
import {
    buildVoiceTransportCapabilitiesResponse,
    getVoiceTransportCapabilities,
    listVoiceTransportCapabilities,
    resolveVoiceTransportBackend,
    resolveVoiceTransportVoiceId,
    voiceTransportSupports,
    VOICE_TRANSPORT_SPECS
} from './voiceTransport'

describe('VOICE_TRANSPORT_SPECS', () => {
    test('all current backends expose STT and TTS', () => {
        for (const backend of ['elevenlabs', 'gemini-live', 'qwen-realtime'] as const) {
            const caps = VOICE_TRANSPORT_SPECS[backend].capabilities
            expect(caps.stt).toBe(true)
            expect(caps.tts).toBe(true)
        }
    })
})

describe('resolveVoiceTransportBackend', () => {
    test('matches resolveEffectiveVoiceBackend semantics', () => {
        const env = {
            VOICE_BACKEND: 'gemini-live',
            GEMINI_API_KEY: 'gm',
            ELEVENLABS_API_KEY: 'el'
        }
        expect(resolveVoiceTransportBackend(env, 'elevenlabs')).toBe('elevenlabs')
        expect(resolveVoiceTransportBackend(env, null)).toBe('gemini-live')
    })
})

describe('resolveVoiceTransportVoiceId', () => {
    test('gemini resolves catalog voice', () => {
        expect(resolveVoiceTransportVoiceId('gemini-live', 'Puck')).toBe('Puck')
    })

    test('elevenlabs falls back to default voice id', () => {
        expect(resolveVoiceTransportVoiceId('elevenlabs', undefined)).toBe(
            VOICE_TRANSPORT_SPECS.elevenlabs.defaultVoiceId
        )
    })
})

describe('voiceTransportSupports', () => {
    test('returns capability flags', () => {
        expect(voiceTransportSupports('elevenlabs', 'stt')).toBe(true)
        expect(voiceTransportSupports('elevenlabs', 'tts')).toBe(true)
    })
})

describe('buildVoiceTransportCapabilitiesResponse', () => {
    test('lists capabilities for configured backends only', () => {
        const resp = buildVoiceTransportCapabilitiesResponse({
            ELEVENLABS_API_KEY: 'el',
            GEMINI_API_KEY: 'gm'
        })
        expect(resp.backends).toEqual(['elevenlabs', 'gemini-live'])
        expect(resp.capabilities.elevenlabs).toEqual(getVoiceTransportCapabilities('elevenlabs'))
        expect(resp.capabilities['qwen-realtime']).toBeUndefined()
    })
})

describe('listVoiceTransportCapabilities', () => {
    test('returns map keyed by backend', () => {
        const map = listVoiceTransportCapabilities(['elevenlabs', 'qwen-realtime'])
        expect(Object.keys(map)).toEqual(['elevenlabs', 'qwen-realtime'])
    })
})
