export type VoiceAudioLevels = {
    connected: boolean
    input: number
    output: number
    isSpeaking: boolean
}

const SILENT: VoiceAudioLevels = {
    connected: false,
    input: 0,
    output: 0,
    isSpeaking: false,
}

let levels: VoiceAudioLevels = { ...SILENT }
const listeners = new Set<() => void>()

export function getVoiceAudioLevels(): VoiceAudioLevels {
    return levels
}

export function setVoiceAudioLevels(partial: Partial<VoiceAudioLevels>): void {
    levels = { ...levels, ...partial }
    for (const listener of listeners) {
        listener()
    }
}

export function resetVoiceAudioLevels(): void {
    levels = { ...SILENT }
    for (const listener of listeners) {
        listener()
    }
}

export function subscribeVoiceAudioLevels(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** Exponential smoothing for rAF-driven visuals (0 = frozen, 1 = instant). */
export function smoothLevel(current: number, target: number, factor: number): number {
    return current + (target - current) * factor
}

/**
 * Compute RMS amplitude (0..1) of a PCM16 little-endian base64 audio chunk.
 *
 * Used by Gemini Live and Qwen Realtime sessions, which already pass base64-encoded
 * PCM16 frames through their hot paths (player.enqueue / recorder upload). RMS-ing
 * those bytes inline gives us per-frame audio levels with no AnalyserNode plumbing
 * and no extra Web Audio nodes — same fidelity as ElevenLabs' getInputVolume/
 * getOutputVolume getters, but free.
 *
 * Returns 0 for empty / malformed input. The 16384 normaliser caps a typical loud-
 * but-not-clipped signal at ~1.0 (full-range RMS for sine ~ 23170; we trade a tiny
 * bit of headroom for nicer ring saturation without ever exceeding 1).
 */
export function rmsFromPcm16Base64(b64: string): number {
    if (!b64) {
        return 0
    }
    let bin: string
    try {
        bin = atob(b64)
    } catch {
        return 0
    }
    const sampleCount = bin.length >> 1
    if (sampleCount === 0) {
        return 0
    }
    let sumSq = 0
    for (let i = 0; i < sampleCount; i++) {
        const lo = bin.charCodeAt(i * 2)
        const hi = bin.charCodeAt(i * 2 + 1)
        // sign-extend 16-bit two's complement
        const sample = ((hi << 8) | lo) << 16 >> 16
        sumSq += sample * sample
    }
    return Math.min(1, Math.sqrt(sumSq / sampleCount) / 16384)
}

/**
 * Publish a binary "speaking pulse" for backends that don't expose audio volume getters
 * AND don't (yet) feed RMS chunks. Drives the reactive rings off speaking state alone.
 *
 * Prefer `setVoiceAudioLevels({ output: rmsFromPcm16Base64(chunk), ... })` when the
 * raw PCM is in hand. This pulse is a fallback for "I know the agent started/stopped
 * speaking but I don't have a sample-level signal."
 *
 * - speaking=true: output=0.65 (fixed pulse), input=0 (mic muted while model speaks),
 *   isSpeaking=true, connected=true.
 * - speaking=false: output=0, input=0.25 (mic open, no level info), isSpeaking=false.
 */
export function setVoiceSpeakingPulse(speaking: boolean): void {
    setVoiceAudioLevels(
        speaking
            ? { connected: true, output: 0.65, input: 0, isSpeaking: true }
            : { connected: true, output: 0, input: 0.25, isSpeaking: false },
    )
}
