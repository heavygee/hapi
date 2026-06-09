import { describe, expect, it } from 'vitest'

import type { ClaudeUsage } from '@hapi/protocol/types'

import { toClaudeBudgetState } from './claudeBudgetAdapter'

const empty = (): ClaudeUsage => ({ rateLimits: {} })

describe('toClaudeBudgetState', () => {
    it('returns null when usage is undefined', () => {
        expect(toClaudeBudgetState(undefined)).toBeNull()
        expect(toClaudeBudgetState(null)).toBeNull()
    })

    it('returns null when there are no axes (no context, no rate limits)', () => {
        expect(toClaudeBudgetState(empty())).toBeNull()
    })

    it('produces a context-only state with green effective when fresh', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 20000, limitTokens: 200000, percent: 10, updatedAt: 1 },
            rateLimits: {}
        })
        expect(state).not.toBeNull()
        expect(state?.axes.map((a) => a.id)).toEqual(['context'])
        expect(state?.operationalAxisId).toBe('context')
        expect(state?.effective).toBe('green')
        expect(state?.axes[0]?.valueText).toBe('10%')
    })

    it('marks amber when context crosses 60%', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 130000, limitTokens: 200000, percent: 65, updatedAt: 1 },
            rateLimits: {}
        })
        expect(state?.effective).toBe('amber')
    })

    it('marks red when context crosses 90%', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 190000, limitTokens: 200000, percent: 95, updatedAt: 1 },
            rateLimits: {}
        })
        expect(state?.effective).toBe('red')
    })

    it('renders 5h + weekly rate-limit axes with stable ordering', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 20000, limitTokens: 200000, percent: 10, updatedAt: 1 },
            rateLimits: {
                weekly_max: { status: 'allowed_warning', rateLimitType: 'weekly_max', utilization: 0.7, updatedAt: 1, resetsAt: 1780000000000 },
                session_5h: { status: 'allowed_warning', rateLimitType: 'session_5h', utilization: 0.4, updatedAt: 1 }
            }
        })
        expect(state?.axes.map((a) => a.id)).toEqual(['context', 'fiveHour', 'weekly'])
        expect(state?.dominantAxisId).toBe('weekly')
        expect(state?.effective).toBe('amber')
    })

    it('marks blocked + critical when a rate limit has status=rejected', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 20000, limitTokens: 200000, percent: 10, updatedAt: 1 },
            rateLimits: {
                weekly_max: { status: 'rejected', rateLimitType: 'weekly_max', utilization: 1, updatedAt: 1, resetsAt: 1780000000000 }
            }
        })
        expect(state?.effective).toBe('blocked')
        const weekly = state?.axes.find((a) => a.id === 'weekly')
        expect(weekly?.critical).toBe(true)
        expect(weekly?.valueText).toBe('Blocked')
        expect(state?.effectiveReason).toContain('Weekly')
    })

    it('keeps the centre on context even when weekly is dominant', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 20000, limitTokens: 200000, percent: 10, updatedAt: 1 },
            rateLimits: {
                weekly_max: { status: 'allowed_warning', rateLimitType: 'weekly_max', utilization: 0.85, updatedAt: 1 }
            }
        })
        expect(state?.operationalAxisId).toBe('context')
        expect(state?.dominantAxisId).toBe('weekly')
    })

    it('falls back to the first axis as operational when context is missing', () => {
        const state = toClaudeBudgetState({
            rateLimits: {
                session_5h: { status: 'allowed_warning', rateLimitType: 'session_5h', utilization: 0.5, updatedAt: 1 }
            }
        })
        expect(state?.operationalAxisId).toBe('fiveHour')
    })

    it('labels unknown rateLimitType variants best-effort', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 0, limitTokens: 200000, percent: 0, updatedAt: 1 },
            rateLimits: {
                custom_overlay: { status: 'allowed_warning', rateLimitType: 'custom_overlay', utilization: 0.3, updatedAt: 1 }
            }
        })
        const axis = state?.axes.find((a) => a.label === 'Custom Overlay')
        expect(axis).toBeTruthy()
        expect(axis?.id).toMatch(/^rateLimit:/)
    })

    it('renders a Cost metadata row when totalCostUSD > 0', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 10000, limitTokens: 200000, percent: 5, updatedAt: 1 },
            rateLimits: {},
            totalCostUSD: 0.42
        })
        const cost = state?.metadata?.find((m) => m.label === 'Cost (session)')
        expect(cost?.value).toBe('$0.42')
    })

    it('renders a token breakdown row when modelUsage carries token counts', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 10000, limitTokens: 200000, percent: 5, updatedAt: 1 },
            rateLimits: {},
            modelUsage: {
                'claude-sonnet-4-5': {
                    inputTokens: 1234,
                    outputTokens: 5678,
                    cacheReadInputTokens: 90000
                }
            }
        })
        const tokens = state?.metadata?.find((m) => m.label === 'Tokens (session)')
        expect(tokens?.value).toContain('in')
        expect(tokens?.value).toContain('out')
        expect(tokens?.value).toContain('cache')
    })

    it('shows resolved model in metadata when present', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 10000, limitTokens: 200000, percent: 5, updatedAt: 1 },
            rateLimits: {},
            resolvedModel: 'claude-sonnet-4-5'
        })
        expect(state?.metadata?.find((m) => m.label === 'Model')?.value).toBe('claude-sonnet-4-5')
    })

    it('trims trailing zeros from cost display', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 10000, limitTokens: 200000, percent: 5, updatedAt: 1 },
            rateLimits: {},
            totalCostUSD: 0.5
        })
        const cost = state?.metadata?.find((m) => m.label === 'Cost (session)')
        expect(cost?.value).toBe('$0.5')
    })

    it('does not render Cost row when totalCostUSD is zero', () => {
        const state = toClaudeBudgetState({
            contextWindow: { usedTokens: 10000, limitTokens: 200000, percent: 5, updatedAt: 1 },
            rateLimits: {},
            totalCostUSD: 0
        })
        expect(state?.metadata?.find((m) => m.label === 'Cost (session)')).toBeUndefined()
    })
})
