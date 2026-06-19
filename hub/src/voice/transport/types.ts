import type { VoiceBackendType } from '@hapi/protocol/voice'
import type { VoiceBackendEnv } from '@hapi/protocol/voice'

export type VoiceTransportEnv = VoiceBackendEnv & {
    GEMINI_API_BASE?: string
    DASHSCOPE_API_BASE?: string
}

export interface VoiceSttInput {
    audio: Uint8Array
    mimeType: string
    language?: string
}

export interface VoiceSttResult {
    text: string
    language?: string
}

export interface VoiceTtsInput {
    text: string
    voiceId: string
    language?: string
}

export interface VoiceTtsResult {
    audio: Uint8Array
    mimeType: string
}

export type VoiceTransportFetch = typeof fetch

export interface VoiceTransportContext {
    env: VoiceTransportEnv
    fetchImpl: VoiceTransportFetch
}

export interface VoiceTransportShim {
    transcribe(ctx: VoiceTransportContext, input: VoiceSttInput): Promise<VoiceSttResult>
    synthesize(ctx: VoiceTransportContext, input: VoiceTtsInput): Promise<VoiceTtsResult>
}

export type VoiceTransportRegistry = Record<VoiceBackendType, VoiceTransportShim>

function decodeBase64Audio(audioBase64: string): Uint8Array {
    const binary = Buffer.from(audioBase64, 'base64')
    return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
}

export function decodeVoiceSttAudio(audioBase64: string): Uint8Array {
    return decodeBase64Audio(audioBase64)
}

export function encodeVoiceTtsAudio(audio: Uint8Array): string {
    return Buffer.from(audio).toString('base64')
}

export async function readResponseBodyBytes(response: Response): Promise<Uint8Array> {
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
}

export async function readResponseJson<T>(response: Response): Promise<T> {
    return await response.json() as T
}

export function voiceTransportError(message: string, status = 502): Error & { status: number } {
    const err = new Error(message) as Error & { status: number }
    err.status = status
    return err
}
