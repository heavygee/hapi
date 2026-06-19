import type { VoiceBackendType } from '@hapi/protocol/voice'
import {
    assertVoiceTransportBackendConfigured,
    getVoiceTransportCapabilities,
    resolveVoiceTransportVoiceId,
    voiceTransportSupports,
    type VoiceSpeechMode
} from '@hapi/protocol/voiceTransport'
import { elevenlabsTransportShim } from './elevenlabs'
import { geminiTransportShim } from './gemini'
import { qwenTransportShim } from './qwen'
import type {
    VoiceSttInput,
    VoiceSttResult,
    VoiceTransportContext,
    VoiceTransportEnv,
    VoiceTransportRegistry,
    VoiceTransportShim,
    VoiceTtsInput,
    VoiceTtsResult
} from './types'
import { voiceTransportError } from './types'

export const VOICE_TRANSPORT_SHIMS: VoiceTransportRegistry = {
    elevenlabs: elevenlabsTransportShim,
    'gemini-live': geminiTransportShim,
    'qwen-realtime': qwenTransportShim
}

export function getVoiceTransportShim(backend: VoiceBackendType): VoiceTransportShim {
    return VOICE_TRANSPORT_SHIMS[backend]
}

export function createVoiceTransportContext(
    env: VoiceTransportEnv,
    fetchImpl: typeof fetch = fetch
): VoiceTransportContext {
    return { env, fetchImpl }
}

function assertBackendReady(
    ctx: VoiceTransportContext,
    backend: VoiceBackendType,
    mode: VoiceSpeechMode
): void {
    if (!assertVoiceTransportBackendConfigured(ctx.env, backend)) {
        throw voiceTransportError(`Voice backend not configured: ${backend}`, 400)
    }
    const caps = getVoiceTransportCapabilities(backend)
    if (!voiceTransportSupports(backend, mode)) {
        throw voiceTransportError(`${backend} does not support ${mode.toUpperCase()}`, 501)
    }
    if (mode === 'stt' && !caps.stt) {
        throw voiceTransportError(`${backend} STT is disabled`, 501)
    }
    if (mode === 'tts' && !caps.tts) {
        throw voiceTransportError(`${backend} TTS is disabled`, 501)
    }
}

export async function runVoiceStt(
    ctx: VoiceTransportContext,
    backend: VoiceBackendType,
    input: VoiceSttInput
): Promise<VoiceSttResult> {
    assertBackendReady(ctx, backend, 'stt')
    return await getVoiceTransportShim(backend).transcribe(ctx, input)
}

export async function runVoiceTts(
    ctx: VoiceTransportContext,
    backend: VoiceBackendType,
    input: VoiceTtsInput
): Promise<VoiceTtsResult> {
    assertBackendReady(ctx, backend, 'tts')
    const voiceId = resolveVoiceTransportVoiceId(backend, input.voiceId)
    return await getVoiceTransportShim(backend).synthesize(ctx, { ...input, voiceId })
}

export { encodeVoiceTtsAudio, decodeVoiceSttAudio } from './types'
export type { VoiceTransportEnv } from './types'
