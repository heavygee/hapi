import { ELEVENLABS_API_BASE } from '@hapi/protocol/voice'
import { getVoiceTransportSpec } from '@hapi/protocol/voiceTransport'
import type {
    VoiceSttInput,
    VoiceSttResult,
    VoiceTransportContext,
    VoiceTransportShim,
    VoiceTtsInput,
    VoiceTtsResult
} from './types'
import { readResponseBodyBytes, readResponseJson, voiceTransportError } from './types'

interface ElevenLabsSttResponse {
    text?: string
    language_code?: string
}

export const elevenlabsTransportShim: VoiceTransportShim = {
    async transcribe(ctx: VoiceTransportContext, input: VoiceSttInput): Promise<VoiceSttResult> {
        const apiKey = ctx.env.ELEVENLABS_API_KEY?.trim()
        if (!apiKey) {
            throw voiceTransportError('ElevenLabs API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('elevenlabs')
        const form = new FormData()
        const blob = new Blob([input.audio], { type: input.mimeType || 'application/octet-stream' })
        form.append('file', blob, 'audio')
        form.append('model_id', spec.sttModel)
        if (input.language) {
            form.append('language_code', input.language)
        }

        const response = await ctx.fetchImpl(`${ELEVENLABS_API_BASE}/speech-to-text`, {
            method: 'POST',
            headers: { 'xi-api-key': apiKey },
            body: form
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `ElevenLabs STT failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const data = await readResponseJson<ElevenLabsSttResponse>(response)
        const text = data.text?.trim() ?? ''
        if (!text) {
            throw voiceTransportError('ElevenLabs STT returned empty transcript', 502)
        }

        return {
            text,
            language: data.language_code
        }
    },

    async synthesize(ctx: VoiceTransportContext, input: VoiceTtsInput): Promise<VoiceTtsResult> {
        const apiKey = ctx.env.ELEVENLABS_API_KEY?.trim()
        if (!apiKey) {
            throw voiceTransportError('ElevenLabs API key not configured', 400)
        }

        const spec = getVoiceTransportSpec('elevenlabs')
        const response = await ctx.fetchImpl(
            `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(input.voiceId)}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    Accept: 'audio/mpeg'
                },
                body: JSON.stringify({
                    text: input.text,
                    model_id: spec.ttsModel
                })
            }
        )

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw voiceTransportError(
                detail || `ElevenLabs TTS failed (${response.status})`,
                response.status >= 400 && response.status < 500 ? response.status : 502
            )
        }

        const audio = await readResponseBodyBytes(response)
        const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg'
        return { audio, mimeType }
    }
}
