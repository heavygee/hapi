/**
 * Voice-mode turn-shape instruction for non-Cursor agent flavors.
 *
 * Set per-session via `metadata.voiceMode` (shared/src/schemas.ts) when a
 * voice relay is bound to this session. Resolved once at session bootstrap
 * (cli/src/api/api.ts) — same cadence as the session-summary contract — so
 * it persists across resume and does not require re-teaching per message.
 *
 * Cursor ACP has no system-prompt / rules-overlay seam in upstream today, so
 * it is intentionally not covered here, matching `sessionSummaryInstruction.ts`.
 *
 * Deliberately NOT inherited by spawned/pinged peer sessions: a voice-bound
 * session routinely delegates multi-step research to a peer whose own output
 * needs full fidelity. Only the session actually bound to voice shapes its
 * own replies this way.
 */

/**
 * Discoverability hint for the `set_voice_mode` MCP tool (Claude flavor only
 * for now — see docs/plans/2026-10-08-voice-modality-turn-shape.md for the
 * other-flavor fast-follow).
 */
export const SET_VOICE_MODE_PROMPT_CLAUDE =
    'If you learn this session is relaying for a voice conversation (or stops being one), call "mcp__hapi__set_voice_mode" once to match.'

let voiceModeEnabled = false

/** Apply the hub-resolved per-session flag (from session create/get bootstrap). */
export function applyVoiceModePreference(enabled: boolean): void {
    voiceModeEnabled = enabled
}

/** Test-only: clear voice-mode state between cases. */
export function resetVoiceModeForTests(): void {
    voiceModeEnabled = false
}

export function isVoiceModeEnabled(): boolean {
    return voiceModeEnabled
}

/**
 * Short and behavioral by design — a bulleted list of banned markdown gets
 * ignored by turn three; a flat rule survives pressure better. Must agree
 * with, not compete with, the AGENT_NOTIFY_SUMMARY footer (also spoken):
 * this block is appended before that footer so the footer stays the final
 * line unchanged.
 */
export function buildVoiceModeInstruction(): string {
    return [
        'Voice mode:',
        'This reply may be read aloud to someone who cannot see formatting.',
        'Answer in one or two short sentences, then ask one question that moves',
        'the work forward. Do not use headings, bold, tables, or lists. Share one',
        'fact or step at a time and wait for the next reply — do not dump',
        'everything you know.'
    ].join('\n')
}

/** Empty string when disabled so callers can append unconditionally. */
export function voiceModeInstructionOrEmpty(): string {
    return isVoiceModeEnabled() ? buildVoiceModeInstruction() : ''
}

/** Append instruction to an existing prompt block (blank line separator). */
export function withVoiceModeInstruction(base: string): string {
    const extra = voiceModeInstructionOrEmpty()
    if (!extra) return base
    const trimmed = base.trimEnd()
    return trimmed.length > 0 ? `${trimmed}\n\n${extra}` : extra
}
