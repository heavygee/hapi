import { describe, expect, it } from 'vitest'

import { ClaudeUsageSchema, MetadataSchema } from './schemas'

describe('ClaudeUsageSchema', () => {
    it('accepts an empty payload with default rateLimits', () => {
        const parsed = ClaudeUsageSchema.parse({})
        expect(parsed.rateLimits).toEqual({})
    })

    it('parses a full payload including rate limits + per-model usage', () => {
        const parsed = ClaudeUsageSchema.parse({
            contextWindow: {
                usedTokens: 12345,
                limitTokens: 200000,
                percent: 6.17,
                updatedAt: 1780000000000
            },
            rateLimits: {
                session_5h: {
                    status: 'allowed_warning',
                    rateLimitType: 'session_5h',
                    utilization: 0.5,
                    updatedAt: 1780000000000,
                    resetsAt: 1780002000000
                },
                weekly_max: {
                    status: 'rejected',
                    rateLimitType: 'weekly_max',
                    utilization: 1,
                    updatedAt: 1780000000000
                }
            },
            modelUsage: {
                'claude-sonnet-4-5': {
                    inputTokens: 100,
                    outputTokens: 200,
                    contextWindow: 200000,
                    maxOutputTokens: 8192,
                    costUSD: 0.1
                }
            },
            totalCostUSD: 0.42,
            resolvedModel: 'claude-sonnet-4-5'
        })
        expect(parsed.rateLimits?.['session_5h']?.utilization).toBe(0.5)
        expect(parsed.rateLimits?.['weekly_max']?.status).toBe('rejected')
        expect(parsed.modelUsage?.['claude-sonnet-4-5']?.contextWindow).toBe(200000)
    })

    it('accepts unknown rateLimitType strings (record over opaque key)', () => {
        const parsed = ClaudeUsageSchema.parse({
            rateLimits: {
                future_quarterly: {
                    status: 'allowed_warning',
                    rateLimitType: 'future_quarterly',
                    utilization: 0.1,
                    updatedAt: 1
                }
            }
        })
        expect(Object.keys(parsed.rateLimits ?? {})).toContain('future_quarterly')
    })

    it('rejects unknown rate-limit status enum values', () => {
        expect(() => ClaudeUsageSchema.parse({
            rateLimits: {
                session_5h: {
                    status: 'totally-made-up',
                    rateLimitType: 'session_5h',
                    utilization: 0.1,
                    updatedAt: 1
                }
            }
        })).toThrow()
    })

    it('Metadata.claudeUsage round-trips through MetadataSchema', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp',
            host: 'h',
            claudeUsage: {
                rateLimits: {
                    session_5h: {
                        status: 'allowed_warning',
                        rateLimitType: 'session_5h',
                        utilization: 0.42,
                        updatedAt: 1
                    }
                }
            }
        })
        expect(parsed.claudeUsage?.rateLimits?.['session_5h']?.utilization).toBe(0.42)
    })
})
