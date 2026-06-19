import { resolveGeminiLiveVoice } from '@hapi/protocol/voicePickerCatalog'
import { getVoiceTransportSpec } from '@hapi/protocol/voiceTransport'
import type {
    VoiceSttInput,
    VoiceSttResult,
    VoiceTransportContext,
    VoiceTransportShim,
    VoiceTtsInput,
    VoiceTtsResult
} from './types'
import { readResponseJson, voiceTransportError } from './types'

const DEFAULT_GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function geminiApiKey(env: VoiceTransportContext['env']): string | null {
    const key = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
    return key && key.length > 0 ? key : null
}

function geminiRestBase(env: VoiceTransportContext['env']): string {
    const raw = env.GEMINI_API_BASE?.trim()
    if (!raw) {
        return DEFAULT_GEMINI_REST_BASE
    }
    return raw.replace(/\/$/, '')
}

function audioDataUri(mimeType: string, audio: Uint8Array): string {
    const base64 = Buffer.from(audio).toString('base64')
    return `data:${mimeType};base64,${base64}`
}

interface GeminiGenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string
                inlineData?: {
                    mimeType?: string
                    data?: string
                }
            }>
        }
    }>
    error?: { message?: string }
}

export const geminiTransportShim: VoiceTransportShim = {
    async transcribe(ctx: VoiceTransportContext, input: VoiceSttInput): Promise<VoiceSttResult> {
        const apiKey = geminiApiKey(ctx.env)
        if (!apiKey) {
            throw voiceTransportError('Gemini API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('gemini-live')
        const prompt = input.language
            ? `Transcribe this audio verbatim. The spoken language is likely ${input.language}. Return only the transcript text.`
            : 'Transcribe this audio verbatim. Return only the transcript text.'

        const url = `${geminiRestBase(ctx.env)}/models/${spec.sttModel}:generateContent?key=${encodeURIComponent(apiKey)}`
        const response = await ctx.fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: input.mimeType || 'audio/wav',
                                data: Buffer.from(input.audio).toString('base64')
                            }
                        }
                    ]
                }]
            })
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `Gemini STT failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const data = await readResponseJson<GeminiGenerateContentResponse>(response)
        if (data.error?.message) {
            throw voiceTransportError(data.error.message, 502)
        }

        const text = data.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? '')
            .join('')
            .trim() ?? ''

        if (!text) {
            throw voiceTransportError('Gemini STT returned empty transcript', 502)
        }

        return { text, language: input.language }
    },

    async synthesize(ctx: VoiceTransportContext, input: VoiceTtsInput): Promise<VoiceTtsResult> {
        const apiKey = geminiApiKey(ctx.env)
        if (!apiKey) {
            throw voiceTransportError('Gemini API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('gemini-live')
        const voiceName = resolveGeminiLiveVoice(input.voiceId)
        const url = `${geminiRestBase(ctx.env)}/models/${spec.ttsModel}:generateContent?key=${encodeURIComponent(apiKey)}`

        const response = await ctx.fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: input.text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName }
                        }
                    }
                }
            })
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `Gemini TTS failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const data = await readResponseJson<GeminiGenerateContentResponse>(response)
        if (data.error?.message) {
            throw voiceTransportError(data.error.message, 502)
        }

        const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData
        if (!inline?.data) {
            throw voiceTransportError('Gemini TTS returned no audio', 502)
        }

        const audio = Buffer.from(inline.data, 'base64')
        const mimeType = inline.mimeType?.split(';')[0]?.trim() || 'audio/wav'
        return {
            audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
            mimeType
        }
    }
}
