import { describe, expect, it } from 'vitest'
import {
    shouldBumpThinkingFromSessionUpdate,
    thinkingHintFromSessionUpdate,
} from './shouldBumpThinkingFromSessionUpdate'
import { ACP_SESSION_UPDATE_TYPES } from './constants'

describe('thinkingHintFromSessionUpdate', () => {
    it.each([
        ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
        ACP_SESSION_UPDATE_TYPES.agentThoughtChunk,
        ACP_SESSION_UPDATE_TYPES.toolCall,
        ACP_SESSION_UPDATE_TYPES.toolCallUpdate,
        ACP_SESSION_UPDATE_TYPES.plan,
        'agent_message',
        'agent_thought',
        'user_message',
        'user_message_chunk',
        'tool_call_content_chunk',
    ] as const)('returns true for activity type %s', (sessionUpdate) => {
        expect(thinkingHintFromSessionUpdate({ sessionUpdate })).toBe(true)
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(true)
    })

    it('ignores ACP v2 state_update (Cursor chatters running/idle while queue-idle)', () => {
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'running',
        })).toBeNull()
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'requires_action',
        })).toBeNull()
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'idle',
        })).toBeNull()
    })

    it.each([
        ACP_SESSION_UPDATE_TYPES.usageUpdate,
        ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate,
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
    ] as const)('returns null for noise type %s', (sessionUpdate) => {
        expect(thinkingHintFromSessionUpdate({ sessionUpdate })).toBeNull()
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(false)
    })

    it('returns null for missing or non-string sessionUpdate', () => {
        expect(thinkingHintFromSessionUpdate(null)).toBeNull()
        expect(thinkingHintFromSessionUpdate(undefined)).toBeNull()
        expect(thinkingHintFromSessionUpdate({})).toBeNull()
        expect(thinkingHintFromSessionUpdate({ sessionUpdate: 12 })).toBeNull()
    })
})
