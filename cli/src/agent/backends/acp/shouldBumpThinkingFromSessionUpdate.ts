/**
 * Gate for harness/ACP resume → hub thinking (#1470 / #1502).
 *
 * Returns:
 * - `true` — real agent activity (bump thinking)
 * - `false` — ACP v2 `state_update: idle` (clear thinking)
 * - `null` — noise / unknown / state_update running chatter (do not touch)
 *
 * Cursor chatters `state_update` running/idle while HAPI MessageQueue is idle.
 * Mapping `running` onto hub thinking caused list spinner flicker after #1487.
 * Ignore running/requires_action; still clear on idle so mid-idle wakes do not stick.
 */
export type SessionUpdateThinkingHint = boolean | null

export function thinkingHintFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): SessionUpdateThinkingHint {
    if (!update || typeof update.sessionUpdate !== 'string') {
        return null
    }

    switch (update.sessionUpdate) {
        case 'agent_message_chunk':
        case 'agent_message':
        case 'agent_thought_chunk':
        case 'agent_thought':
        case 'tool_call':
        case 'tool_call_update':
        case 'tool_call_content_chunk':
        case 'plan':
        case 'user_message':
        case 'user_message_chunk':
            return true
        case 'state_update':
            // Never bump from running/requires_action — Cursor emits these while
            // HAPI is queue-idle and they flipped session-list spinners (#1502).
            // Permission bumps go through setAgentActivityListener(true) directly.
            if (update.state === 'idle') {
                return false
            }
            return null
        default:
            return null
    }
}

/** @deprecated Prefer thinkingHintFromSessionUpdate; kept for call-site clarity in tests. */
export function shouldBumpThinkingFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): boolean {
    return thinkingHintFromSessionUpdate(update) === true
}
