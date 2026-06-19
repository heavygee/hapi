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

const DEFAULT_DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com/api/v1'

/** CosyVoice system voices — Realtime picker ids (Tina, Cherry, …) map here. */
const QWEN_REALTIME_TO_COSYVOICE: Record<string, string> = {
    Tina: 'longxiaochun',
    Cherry: 'longwan',
    Mia: 'longmiao',
    Chelsie: 'longyue',
    Serena: 'longjing',
    Ethan: 'longshu'
}

function dashscopeApiKey(env: VoiceTransportContext['env']): string | null {
    const key = env.DASHSCOPE_API_KEY?.trim() || env.QWEN_API_KEY?.trim()
    return key && key.length > 0 ? key : null
}

function dashscopeBase(env: VoiceTransportContext['env']): string {
    const raw = env.DASHSCOPE_API_BASE?.trim()
    if (!raw) {
        return DEFAULT_DASHSCOPE_BASE
    }
    return raw.replace(/\/$/, '')
}

export function resolveQwenCosyVoice(voiceId: string): string {
    return QWEN_REALTIME_TO_COSYVOICE[voiceId] ?? voiceId
}

function audioDataUri(mimeType: string, audio: Uint8Array): string {
    return `data:${mimeType};base64,${Buffer.from(audio).toString('base64')}`
}

interface QwenAsrResponse {
    output?: {
        choices?: Array<{
            message?: {
                content?: Array<{ text?: string }> | string
            }
        }>
    }
    message?: string
}

interface QwenTtsResponse {
    output?: {
        audio?: string
        finish_reason?: string
    }
    message?: string
}

function extractQwenAsrText(data: QwenAsrResponse): string {
    const content = data.output?.choices?.[0]?.message?.content
    if (typeof content === 'string') {
        return content.trim()
    }
    if (Array.isArray(content)) {
        return content.map((part) => part.text ?? '').join('').trim()
    }
    return ''
}

export const qwenTransportShim: VoiceTransportShim = {
    async transcribe(ctx: VoiceTransportContext, input: VoiceSttInput): Promise<VoiceSttResult> {
        const apiKey = dashscopeApiKey(ctx.env)
        if (!apiKey) {
            throw voiceTransportError('DashScope API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('qwen-realtime')
        const url = `${dashscopeBase(ctx.env)}/services/aigc/multimodal-generation/generation`

        const response = await ctx.fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: spec.sttModel,
                input: {
                    messages: [
                        { role: 'system', content: [{ text: '' }] },
                        {
                            role: 'user',
                            content: [{ audio: audioDataUri(input.mimeType || 'audio/wav', input.audio) }]
                        }
                    ]
                },
                parameters: {
                    asr_options: {
                        enable_itn: false,
                        ...(input.language ? { language: input.language } : {})
                    }
                }
            })
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `Qwen STT failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const data = await readResponseJson<QwenAsrResponse>(response)
        const text = extractQwenAsrText(data)
        if (!text) {
            throw voiceTransportError(data.message || 'Qwen STT returned empty transcript', 502)
        }

        return { text, language: input.language }
    },

    async synthesize(ctx: VoiceTransportContext, input: VoiceTtsInput): Promise<VoiceTtsResult> {
        const apiKey = dashscopeApiKey(ctx.env)
        if (!apiKey) {
            throw voiceTransportError('DashScope API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('qwen-realtime')
        const voice = resolveQwenCosyVoice(input.voiceId)
        const url = `${dashscopeBase(ctx.env)}/services/audio/tts/SpeechSynthesizer`

        const response = await ctx.fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: spec.ttsModel,
                input: {
                    text: input.text,
                    voice,
                    format: 'mp3',
                    sample_rate: 24000
                }
            })
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `Qwen TTS failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const data = await readResponseJson<QwenTtsResponse>(response)
        const audioB64 = data.output?.audio
        if (!audioB64) {
            throw voiceTransportError(data.message || 'Qwen TTS returned no audio', 502)
        }

        const audio = Buffer.from(audioB64, 'base64')
        return {
            audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
            mimeType: 'audio/mpeg'
        }
    }
}
