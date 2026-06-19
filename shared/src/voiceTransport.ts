/**
 * Standalone STT/TTS transport layer for voice backends (#29).
 *
 * Normalizes per-provider endpoint shapes behind one interface. Realtime
 * conversational sessions stay in voice.ts; this module is the invisible
 * plumbing for dictation + read-back (#27).
 */

import {
    DEFAULT_VOICE_BACKEND,
    type VoiceBackendType,
    resolveEffectiveVoiceBackend,
    listConfiguredVoiceBackends,
    resolveHubVoiceBackend,
    type VoiceBackendEnv
} from './voice'
import { GEMINI_LIVE_VOICE, QWEN_REALTIME_VOICE } from './voice'
import { resolveGeminiLiveVoice, resolveQwenRealtimeVoice } from './voicePickerCatalog'

export type VoiceSpeechMode = 'stt' | 'tts'

/** Per-backend standalone speech capabilities (graceful disable when false). */
export interface VoiceTransportCapabilities {
    stt: boolean
    tts: boolean
}

export interface VoiceTransportSpec {
    capabilities: VoiceTransportCapabilities
    sttModel: string
    ttsModel: string
    /** Default voice / voice_id for TTS when caller omits voiceId. */
    defaultVoiceId: string
}

export const VOICE_TRANSPORT_SPECS: Record<VoiceBackendType, VoiceTransportSpec> = {
    elevenlabs: {
        capabilities: { stt: true, tts: true },
        sttModel: 'scribe_v2',
        ttsModel: 'eleven_flash_v2',
        defaultVoiceId: 'cgSgspJ2msm6clMCkdW9'
    },
    'gemini-live': {
        capabilities: { stt: true, tts: true },
        sttModel: 'gemini-2.5-flash',
        ttsModel: 'gemini-2.5-flash-preview-tts',
        defaultVoiceId: GEMINI_LIVE_VOICE
    },
    'qwen-realtime': {
        capabilities: { stt: true, tts: true },
        sttModel: 'qwen3-asr-flash',
        ttsModel: 'cosyvoice-v3-flash',
        // CosyVoice catalog differs from Qwen Realtime prebuilt names; hub maps picker ids.
        defaultVoiceId: QWEN_REALTIME_VOICE
    }
}

export function getVoiceTransportCapabilities(backend: VoiceBackendType): VoiceTransportCapabilities {
    return { ...VOICE_TRANSPORT_SPECS[backend].capabilities }
}

export function getVoiceTransportSpec(backend: VoiceBackendType): VoiceTransportSpec {
    return VOICE_TRANSPORT_SPECS[backend]
}

export function listVoiceTransportCapabilities(
    backends: readonly VoiceBackendType[]
): Record<VoiceBackendType, VoiceTransportCapabilities> {
    const out = {} as Record<VoiceBackendType, VoiceTransportCapabilities>
    for (const backend of backends) {
        out[backend] = getVoiceTransportCapabilities(backend)
    }
    return out
}

/** Effective backend for STT/TTS — same resolution as realtime (no cross-provider mixing). */
export function resolveVoiceTransportBackend(
    env: VoiceBackendEnv,
    storedPreference?: string | null
): VoiceBackendType {
    const configured = listConfiguredVoiceBackends(env)
    const hubDefault = resolveHubVoiceBackend(env)
    return resolveEffectiveVoiceBackend(configured, hubDefault, storedPreference)
}

export function voiceTransportSupports(
    backend: VoiceBackendType,
    mode: VoiceSpeechMode
): boolean {
    const caps = getVoiceTransportCapabilities(backend)
    return mode === 'stt' ? caps.stt : caps.tts
}

/** Resolve TTS voice id/name for the chosen backend. */
export function resolveVoiceTransportVoiceId(
    backend: VoiceBackendType,
    voiceId?: string | null
): string {
    const spec = getVoiceTransportSpec(backend)
    if (backend === 'gemini-live') {
        return resolveGeminiLiveVoice(voiceId ?? spec.defaultVoiceId)
    }
    if (backend === 'qwen-realtime') {
        return resolveQwenRealtimeVoice(voiceId ?? spec.defaultVoiceId)
    }
    const trimmed = voiceId?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : spec.defaultVoiceId
}

export interface VoiceSttRequestBody {
    /** When omitted, hub uses resolveVoiceTransportBackend(env). */
    backend?: VoiceBackendType
    mimeType: string
    audioBase64: string
    language?: string
}

export interface VoiceSttResponseBody {
    backend: VoiceBackendType
    text: string
    language?: string
}

export interface VoiceTtsRequestBody {
    backend?: VoiceBackendType
    text: string
    voiceId?: string
    language?: string
}

export interface VoiceTtsResponseBody {
    backend: VoiceBackendType
    mimeType: string
    audioBase64: string
}

export interface VoiceTransportCapabilitiesResponse {
    backend: VoiceBackendType
    backends: VoiceBackendType[]
    capabilities: Partial<Record<VoiceBackendType, VoiceTransportCapabilities>>
}

export function buildVoiceTransportCapabilitiesResponse(
    env: VoiceBackendEnv
): VoiceTransportCapabilitiesResponse {
    const backends = listConfiguredVoiceBackends(env)
    const backend = resolveHubVoiceBackend(env)
    return {
        backend,
        backends,
        capabilities: listVoiceTransportCapabilities(backends)
    }
}

export function assertVoiceTransportBackendConfigured(
    env: VoiceBackendEnv,
    backend: VoiceBackendType
): boolean {
    return listConfiguredVoiceBackends(env).includes(backend)
}

export const DEFAULT_VOICE_TRANSPORT_BACKEND = DEFAULT_VOICE_BACKEND
