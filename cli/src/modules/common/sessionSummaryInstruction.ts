/**
 * Shared session-status summary instruction for non-Cursor agent flavors.
 *
 * Cursor gets a transient `.cursor/rules/hapi-session.mdc` overlay (no system-
 * prompt channel). Claude / Codex / Grok / OpenCode get this text via their
 * existing system-prompt / developer-instructions / one-shot instruction paths.
 *
 * Opt-out: set `HAPI_SESSION_SUMMARY_CONTRACT=0` (or `false` / `off`). Default
 * is on for HAPI-managed sessions so the overseer / Session Log / voice
 * subscriber see self-reported turn status. Copy is deliberately benign
 * ("session tracking") - never surveillance-framed.
 */

export function isSessionSummaryContractEnabled(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const raw = env.HAPI_SESSION_SUMMARY_CONTRACT
    if (raw === undefined || raw === '') return true
    const normalized = raw.trim().toLowerCase()
    return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no')
}

/**
 * Canonical trailing-line contract. Matches the Cursor rule overlay and
 * `AGENT_NOTIFY_CONTRACT_INLINE_PREFIX` shape in shared overseerEvents.
 */
export const SESSION_SUMMARY_CONTRACT_LINE =
    'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}'

/**
 * Body appended to flavor system / developer instructions when enabled.
 * Keep short - rides every session's prompt budget.
 */
export function buildSessionSummaryInstruction(): string {
    return [
        'Session status summary:',
        'End every response with a single machine-readable status line (no backticks)',
        'so this workspace\'s session tracking can record progress. Put it on its own',
        'final line after all other content:',
        SESSION_SUMMARY_CONTRACT_LINE,
        'Use status "blocked" if unsure. Keep action to 12 words or fewer when status',
        'is "done" and follow-up remains.'
    ].join('\n')
}

/** Empty string when disabled so callers can append unconditionally. */
export function sessionSummaryInstructionOrEmpty(
    env: NodeJS.ProcessEnv = process.env
): string {
    return isSessionSummaryContractEnabled(env) ? buildSessionSummaryInstruction() : ''
}

/** Append instruction to an existing prompt block (blank line separator). */
export function withSessionSummaryInstruction(
    base: string,
    env: NodeJS.ProcessEnv = process.env
): string {
    const extra = sessionSummaryInstructionOrEmpty(env)
    if (!extra) return base
    const trimmed = base.trimEnd()
    return trimmed.length > 0 ? `${trimmed}\n\n${extra}` : extra
}
