import { describe, expect, it, mock } from 'bun:test'
import {
    createVoiceTransportContext,
    runVoiceStt,
    runVoiceTts
} from './index'
import { resolveQwenCosyVoice } from './qwen'

describe('resolveQwenCosyVoice', () => {
    it('maps realtime picker ids to CosyVoice voices', () => {
        expect(resolveQwenCosyVoice('Tina')).toBe('longxiaochun')
        expect(resolveQwenCosyVoice('Cherry')).toBe('longwan')
    })

    it('passes through unknown ids', () => {
        expect(resolveQwenCosyVoice('custom-voice')).toBe('custom-voice')
    })
})

describe('runVoiceStt elevenlabs shim', () => {
    it('returns transcript text from ElevenLabs STT response', async () => {
        const fetchImpl = mock(async (input: string | URL) => {
            const url = String(input)
            expect(url).toContain('/speech-to-text')
            return new Response(JSON.stringify({ text: 'hello world', language_code: 'en' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        const ctx = createVoiceTransportContext(
            { ELEVENLABS_API_KEY: 'test-key' },
            fetchImpl as unknown as typeof fetch
        )
        const result = await runVoiceStt(ctx, 'elevenlabs', {
            audio: new Uint8Array([1, 2, 3]),
            mimeType: 'audio/webm'
        })
        expect(result.text).toBe('hello world')
        expect(result.language).toBe('en')
    })
})

describe('runVoiceTts gemini shim', () => {
    it('returns inline audio from Gemini TTS response', async () => {
        const audioBytes = Buffer.from('fake-audio')
        const fetchImpl = mock(async (input: string | URL) => {
            const url = String(input)
            expect(url).toContain('gemini-2.5-flash-preview-tts')
            return new Response(JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{
                            inlineData: {
                                mimeType: 'audio/wav',
                                data: audioBytes.toString('base64')
                            }
                        }]
                    }
                }]
            }), { status: 200 })
        })

        const ctx = createVoiceTransportContext(
            { GEMINI_API_KEY: 'gm-key' },
            fetchImpl as unknown as typeof fetch
        )
        const result = await runVoiceTts(ctx, 'gemini-live', {
            text: 'Read this back',
            voiceId: 'Kore'
        })
        expect(result.mimeType).toBe('audio/wav')
        expect(Buffer.from(result.audio).toString()).toBe('fake-audio')
    })
})

describe('runVoiceStt qwen shim', () => {
    it('extracts transcript from DashScope ASR response', async () => {
        const fetchImpl = mock(async (input: string | URL) => {
            const url = String(input)
            expect(url).toContain('multimodal-generation/generation')
            return new Response(JSON.stringify({
                output: {
                    choices: [{
                        message: {
                            content: [{ text: 'transcribed text' }]
                        }
                    }]
                }
            }), { status: 200 })
        })

        const ctx = createVoiceTransportContext(
            { DASHSCOPE_API_KEY: 'ds-key' },
            fetchImpl as unknown as typeof fetch
        )
        const result = await runVoiceStt(ctx, 'qwen-realtime', {
            audio: new Uint8Array([9, 9, 9]),
            mimeType: 'audio/wav'
        })
        expect(result.text).toBe('transcribed text')
    })
})
