import { describe, expect, it } from 'vitest'
import { shouldBumpThinkingFromSessionUpdate } from './shouldBumpThinkingFromSessionUpdate'
import { ACP_SESSION_UPDATE_TYPES } from './constants'

describe('shouldBumpThinkingFromSessionUpdate', () => {
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
    ] as const)('bumps for activity type %s', (sessionUpdate) => {
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(true)
    })

    it('bumps for ACP v2 state_update running', () => {
        expect(shouldBumpThinkingFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'running',
        })).toBe(true)
    })

    it('bumps for ACP v2 state_update requires_action', () => {
        expect(shouldBumpThinkingFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'requires_action',
        })).toBe(true)
    })

    it.each([
        ACP_SESSION_UPDATE_TYPES.usageUpdate,
        ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate,
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
    ] as const)('does not bump for noise type %s', (sessionUpdate) => {
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(false)
    })

    it('does not bump for state_update idle', () => {
        expect(shouldBumpThinkingFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'idle',
        })).toBe(false)
    })

    it('does not bump for missing or non-string sessionUpdate', () => {
        expect(shouldBumpThinkingFromSessionUpdate(null)).toBe(false)
        expect(shouldBumpThinkingFromSessionUpdate(undefined)).toBe(false)
        expect(shouldBumpThinkingFromSessionUpdate({})).toBe(false)
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate: 12 })).toBe(false)
    })
})
