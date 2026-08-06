import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    classifySessionAttention,
    isAttentionReviewKind,
    sessionNeedsAttentionReview,
} from './sessionAttention'

function makeSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 1000,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('classifySessionAttention', () => {
    it('returns null for the selected session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', pendingRequestKinds: ['permission'] }),
            { selected: true, lastSeenAt: 0 }
        )
        expect(attention).toBeNull()
    })

    it('prioritizes permission over unread activity', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'permission' })
    })

    it('handles summaries from older APIs without pendingRequestKinds', () => {
        const legacySummary = makeSummary({ id: 'legacy', updatedAt: 5000 }) as unknown as SessionSummary
        delete (legacySummary as Partial<SessionSummary>).pendingRequestKinds

        const attention = classifySessionAttention(
            legacySummary,
            { selected: false, lastSeenAt: 1000 }
        )

        expect(attention).toEqual({ kind: 'unread' })
    })

    it('shows unread activity when the session has updated since last seen', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('shows background work without treating it as unread', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', backgroundTaskCount: 2, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'background' })
    })

    it('shows unread activity for inactive sessions updated since last seen', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: false, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('prefers unread over background for inactive sessions', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                active: false,
                backgroundTaskCount: 2,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })
})

describe('isAttentionReviewKind', () => {
    it('treats permission, input, and unread as review-worthy', () => {
        expect(isAttentionReviewKind('permission')).toBe(true)
        expect(isAttentionReviewKind('input')).toBe(true)
        expect(isAttentionReviewKind('unread')).toBe(true)
    })

    it('excludes background-only busy work from the review filter', () => {
        expect(isAttentionReviewKind('background')).toBe(false)
    })
})

describe('sessionNeedsAttentionReview', () => {
    it('includes permission, input, and unread sessions', () => {
        expect(sessionNeedsAttentionReview(
            makeSummary({ id: 'p', pendingRequestKinds: ['permission'], pendingRequestsCount: 1 }),
            { lastSeenAt: 0 }
        )).toBe(true)

        expect(sessionNeedsAttentionReview(
            makeSummary({ id: 'i', pendingRequestKinds: ['input'], pendingRequestsCount: 1 }),
            { lastSeenAt: 0 }
        )).toBe(true)

        expect(sessionNeedsAttentionReview(
            makeSummary({ id: 'u', updatedAt: 5000 }),
            { lastSeenAt: 1000 }
        )).toBe(true)
    })

    it('excludes background-only and quiet sessions', () => {
        expect(sessionNeedsAttentionReview(
            makeSummary({ id: 'bg', backgroundTaskCount: 2, updatedAt: 5000 }),
            { lastSeenAt: 0 }
        )).toBe(false)

        expect(sessionNeedsAttentionReview(
            makeSummary({ id: 'quiet', updatedAt: 1000 }),
            { lastSeenAt: 5000 }
        )).toBe(false)
    })
})
