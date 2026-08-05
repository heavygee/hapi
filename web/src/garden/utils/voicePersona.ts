/**
 * Per-orb voice persona for Garden.
 *
 * Each session gets a deterministic, stable voice id derived from its sessionId,
 * picked from the active backend's voice catalog. Same agent always sounds the same,
 * different agents always sound different — voice timbre becomes a spatial cue.
 *
 * Implementation note: rather than patch `VoiceContext.startVoice` to thread a per-call
 * voiceId, we transiently write the persona id into the backend's voice picker
 * localStorage key just before `startVoice` and restore the operator's "true" pick
 * after. Backend session start reads `readStoredVoiceSelection(backend)`, so it picks
 * up the persona id without any upstream change.
 *
 * Currently covers Gemini Live and Qwen Realtime (static catalogs). ElevenLabs uses
 * a dynamic voices list — see TODO at end of file.
 */

import {
    GEMINI_LIVE_VOICE_OPTIONS,
    QWEN_REALTIME_VOICE_OPTIONS,
    type VoicePickerOption,
} from '@hapi/protocol/voicePickerCatalog'
import type { VoiceBackendType } from '@hapi/protocol/voice'
import {
    readStoredVoiceSelection,
    writeStoredVoiceSelection,
} from '@/lib/voicePickerPreferences'

/**
 * djb2-style stable hash. Pure JS, no crypto, fast, deterministic across reloads.
 * Returns an unsigned 32-bit integer.
 */
function hashSessionId(sessionId: string): number {
    let h = 5381
    for (let i = 0; i < sessionId.length; i++) {
        h = ((h << 5) + h + sessionId.charCodeAt(i)) >>> 0
    }
    return h
}

/**
 * Pick a deterministic voice for `sessionId` from `options`. Same input → same output.
 */
function pickVoiceFor(sessionId: string, options: readonly VoicePickerOption[]): VoicePickerOption {
    if (options.length === 0) {
        throw new Error('voicePersona: empty voice options list')
    }
    const idx = hashSessionId(sessionId) % options.length
    return options[idx]
}

/**
 * Returns the persona voice option for a session on the given backend, or null
 * for backends Garden doesn't yet handle (currently: ElevenLabs — dynamic list).
 */
export function voicePersonaForSession(
    sessionId: string,
    backend: VoiceBackendType,
): VoicePickerOption | null {
    if (!sessionId) {
        return null
    }
    if (backend === 'gemini-live') {
        return pickVoiceFor(sessionId, GEMINI_LIVE_VOICE_OPTIONS)
    }
    if (backend === 'qwen-realtime') {
        return pickVoiceFor(sessionId, QWEN_REALTIME_VOICE_OPTIONS)
    }
    // ElevenLabs persona requires the dynamic voices list — handled separately.
    return null
}

/**
 * Apply a persona override before a voice session starts. Returns a function that
 * restores the previous storage value, which the caller invokes after `startVoice`
 * resolves (or on error).
 *
 * If `backend` has no persona handler, this is a no-op and the caller falls through
 * to the operator's globally-stored voice pick.
 */
export function applyPersonaOverride(
    sessionId: string,
    backend: VoiceBackendType,
): { persona: VoicePickerOption | null; restore: () => void } {
    const persona = voicePersonaForSession(sessionId, backend)
    if (persona === null) {
        return { persona: null, restore: () => {} }
    }
    const previous = readStoredVoiceSelection(backend)
    writeStoredVoiceSelection(backend, persona.id)
    return {
        persona,
        restore: () => {
            writeStoredVoiceSelection(backend, previous)
        },
    }
}
