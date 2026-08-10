/**
 * Gate for harness/ACP resume → hub thinking (#1470).
 *
 * Keepalive noise (usage / session title) must not flip thinking true.
 * Activity and ACP v2 foreground `state_update: running|requires_action` do.
 */
export function shouldBumpThinkingFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): boolean {
    if (!update || typeof update.sessionUpdate !== 'string') {
        return false
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
            return update.state === 'running' || update.state === 'requires_action'
        default:
            return false
    }
}
