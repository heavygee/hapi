import { describe, it, expect } from 'vitest'

import {
    extractClaudeUsageInput,
    ingestClaudeSDKMessage,
    normalizeClaudeUsage
} from './claudeUsage'

describe('extractClaudeUsageInput', () => {
    it('returns null for chat-only messages', () => {
        expect(extractClaudeUsageInput({ type: 'user', message: { role: 'user', content: 'hi' } } as any)).toBeNull()
        expect(extractClaudeUsageInput({ type: 'control_response', response: {} } as any)).toBeNull()
    })

    it('extracts a rate_limit_event with rejected status', () => {
        const input = extractClaudeUsageInput({
            type: 'rate_limit_event',
            rate_limit_info: {
                status: 'rejected',
                rateLimitType: 'session_5h',
                resetsAt: 1780000000000,
                utilization: 1
            }
        } as any)
        expect(input?.rateLimitEvent).toEqual({
            status: 'rejected',
            rateLimitType: 'session_5h',
            resetsAt: 1780000000000,
            utilization: 1
        })
    })

    it('extracts a rate_limit_event with allowed_warning status', () => {
        const input = extractClaudeUsageInput({
            type: 'rate_limit_event',
            rate_limit_info: {
                status: 'allowed_warning',
                rateLimitType: 'weekly_max',
                resetsAt: 1780000000000,
                utilization: 0.85
            }
        } as any)
        expect(input?.rateLimitEvent?.status).toBe('allowed_warning')
        expect(input?.rateLimitEvent?.utilization).toBe(0.85)
    })

    it('drops malformed rate_limit_event payloads', () => {
        expect(extractClaudeUsageInput({ type: 'rate_limit_event' } as any)).toBeNull()
        expect(extractClaudeUsageInput({ type: 'rate_limit_event', rate_limit_info: null } as any)).toBeNull()
        expect(extractClaudeUsageInput({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected' }
        } as any)).toBeNull()
        expect(extractClaudeUsageInput({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'unknown', rateLimitType: 'x' }
        } as any)).toBeNull()
    })

    it('extracts resolvedModel from system init message', () => {
        const input = extractClaudeUsageInput({
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-5'
        } as any)
        expect(input?.resolvedModel).toBe('claude-sonnet-4-5')
    })

    it('ignores non-init system messages', () => {
        expect(extractClaudeUsageInput({
            type: 'system',
            subtype: 'compact_summary'
        } as any)).toBeNull()
    })

    it('extracts assistant usage including cache tokens and model id', () => {
        const input = extractClaudeUsageInput({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [],
                model: 'claude-opus-4-5',
                usage: {
                    input_tokens: 1234,
                    output_tokens: 567,
                    cache_read_input_tokens: 89000,
                    cache_creation_input_tokens: 2000
                }
            }
        } as any)
        expect(input?.assistantUsage).toEqual({
            inputTokens: 1234,
            outputTokens: 567,
            cacheReadInputTokens: 89000,
            cacheCreationInputTokens: 2000,
            model: 'claude-opus-4-5'
        })
    })

    it('extracts modelUsage and totalCostUSD from result message', () => {
        const input = extractClaudeUsageInput({
            type: 'result',
            subtype: 'success',
            num_turns: 3,
            total_cost_usd: 0.12,
            duration_ms: 1000,
            duration_api_ms: 800,
            is_error: false,
            session_id: 'sess-1',
            modelUsage: {
                'claude-sonnet-4-5': {
                    inputTokens: 100,
                    outputTokens: 200,
                    contextWindow: 200000,
                    maxOutputTokens: 8192,
                    costUSD: 0.12
                }
            }
        } as any)
        expect(input?.totalCostUSD).toBe(0.12)
        expect(input?.modelUsage?.['claude-sonnet-4-5']?.contextWindow).toBe(200000)
    })

    it('returns null for result message without usage telemetry', () => {
        expect(extractClaudeUsageInput({
            type: 'result',
            subtype: 'error_during_execution',
            num_turns: 0,
            duration_ms: 0,
            duration_api_ms: 0,
            is_error: true,
            session_id: 'x'
        } as any)).toBeNull()
    })
})

describe('normalizeClaudeUsage', () => {
    it('starts from empty snapshot when prev is undefined', () => {
        const next = normalizeClaudeUsage(undefined, {
            resolvedModel: 'claude-sonnet-4-5',
            occurredAt: 1
        })
        expect(next.resolvedModel).toBe('claude-sonnet-4-5')
        expect(next.rateLimits).toEqual({})
        expect(next.contextWindow).toBeUndefined()
    })

    it('merges rate-limit events keyed by rateLimitType', () => {
        const a = normalizeClaudeUsage(undefined, {
            rateLimitEvent: {
                status: 'allowed_warning',
                rateLimitType: 'session_5h',
                resetsAt: 100,
                utilization: 0.5
            },
            occurredAt: 10
        })
        const b = normalizeClaudeUsage(a, {
            rateLimitEvent: {
                status: 'rejected',
                rateLimitType: 'weekly_max',
                resetsAt: 200
            },
            occurredAt: 20
        })
        expect(Object.keys(b.rateLimits ?? {})).toEqual(['session_5h', 'weekly_max'])
        expect(b.rateLimits?.['weekly_max']?.utilization).toBe(1)
        expect(b.rateLimits?.['session_5h']?.utilization).toBe(0.5)
    })

    it('overwrites a stale rate-limit when a fresh one arrives for same type', () => {
        const a = normalizeClaudeUsage(undefined, {
            rateLimitEvent: {
                status: 'allowed_warning',
                rateLimitType: 'session_5h',
                resetsAt: 100,
                utilization: 0.5
            },
            occurredAt: 10
        })
        const b = normalizeClaudeUsage(a, {
            rateLimitEvent: {
                status: 'rejected',
                rateLimitType: 'session_5h',
                resetsAt: 200,
                utilization: 1
            },
            occurredAt: 20
        })
        expect(Object.keys(b.rateLimits ?? {})).toEqual(['session_5h'])
        expect(b.rateLimits?.['session_5h']).toEqual({
            status: 'rejected',
            rateLimitType: 'session_5h',
            resetsAt: 200,
            utilization: 1,
            updatedAt: 20
        })
    })

    it('does not pre-compute context window without a known limit', () => {
        const next = normalizeClaudeUsage(undefined, {
            assistantUsage: {
                inputTokens: 1000,
                cacheReadInputTokens: 9000
            },
            occurredAt: 1
        })
        expect(next.contextWindow).toBeUndefined()
    })

    it('computes context window once modelUsage gives a limit', () => {
        const withResult = normalizeClaudeUsage(undefined, {
            resolvedModel: 'claude-sonnet-4-5',
            modelUsage: { 'claude-sonnet-4-5': { contextWindow: 200000 } },
            occurredAt: 1
        })
        const withAssistant = normalizeClaudeUsage(withResult, {
            assistantUsage: {
                inputTokens: 5000,
                outputTokens: 200,
                cacheReadInputTokens: 45000,
                cacheCreationInputTokens: 0
            },
            occurredAt: 2
        })
        expect(withAssistant.contextWindow?.usedTokens).toBe(50000)
        expect(withAssistant.contextWindow?.limitTokens).toBe(200000)
        expect(withAssistant.contextWindow?.percent).toBeCloseTo(25, 1)
    })

    it('falls back to any model contextWindow when assistant message has no model id', () => {
        const withResult = normalizeClaudeUsage(undefined, {
            modelUsage: { 'claude-opus-4-5': { contextWindow: 200000 } },
            occurredAt: 1
        })
        const withAssistant = normalizeClaudeUsage(withResult, {
            assistantUsage: { inputTokens: 1000 },
            occurredAt: 2
        })
        expect(withAssistant.contextWindow?.limitTokens).toBe(200000)
    })

    it('merges modelUsage entries shallowly', () => {
        const a = normalizeClaudeUsage(undefined, {
            modelUsage: { 'claude-sonnet-4-5': { inputTokens: 100, costUSD: 0.01 } },
            occurredAt: 1
        })
        const b = normalizeClaudeUsage(a, {
            modelUsage: { 'claude-sonnet-4-5': { outputTokens: 200, costUSD: 0.05 } },
            occurredAt: 2
        })
        expect(b.modelUsage?.['claude-sonnet-4-5']).toEqual({
            inputTokens: 100,
            outputTokens: 200,
            costUSD: 0.05
        })
    })

    it('clamps context-window percent to 0..100 bounds', () => {
        const withResult = normalizeClaudeUsage(undefined, {
            modelUsage: { 'm': { contextWindow: 100 } },
            occurredAt: 1
        })
        const overflow = normalizeClaudeUsage(withResult, {
            assistantUsage: { inputTokens: 999 },
            occurredAt: 2
        })
        expect(overflow.contextWindow?.percent).toBe(100)
    })
})

describe('ingestClaudeSDKMessage', () => {
    it('passes through prev when message has no telemetry', () => {
        const prev = { rateLimits: {} }
        const next = ingestClaudeSDKMessage(prev, { type: 'user', message: { role: 'user', content: 'hi' } } as any)
        expect(next).toBe(prev)
    })

    it('updates rate limits from a rate_limit_event message', () => {
        const next = ingestClaudeSDKMessage(undefined, {
            type: 'rate_limit_event',
            rate_limit_info: {
                status: 'rejected',
                rateLimitType: 'session_5h',
                resetsAt: 100
            }
        } as any)
        expect(next?.rateLimits?.['session_5h']?.status).toBe('rejected')
    })
})
