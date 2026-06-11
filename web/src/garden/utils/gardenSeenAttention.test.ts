import { describe, expect, it, beforeEach } from 'vitest'
import { clearGardenSeenForTests, getGardenSeen, markGardenSeen } from '@/garden/store/gardenSeenStore'
import {
    attentionReasonForSession,
    sessionNeedsGardenAttention,
} from '@/garden/utils/gardenSeenAttention'
import { resolveOrbShapeKind } from '@/garden/utils/orbShapes'
import type { SessionSummary } from '@/types/api'

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 's1',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 100,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        model: null,
        effort: null,
        ...overrides,
    }
}

describe('sessionNeedsGardenAttention', () => {
    it('needs attention when permission pending', () => {
        expect(sessionNeedsGardenAttention(
            { pendingRequestKinds: ['permission'], updatedAt: 100, thinking: false },
            null,
        )).toBe(true)
    })

    it('needs attention when unseen update landed', () => {
        expect(sessionNeedsGardenAttention(
            { pendingRequestKinds: [], updatedAt: 200, thinking: false },
            { updatedAt: 100, assistantMessageId: 'm1' },
        )).toBe(true)
    })

    it('does not need attention while thinking', () => {
        expect(sessionNeedsGardenAttention(
            { pendingRequestKinds: [], updatedAt: 200, thinking: true },
            null,
        )).toBe(false)
    })

    it('does not need attention when seen', () => {
        expect(sessionNeedsGardenAttention(
            { pendingRequestKinds: [], updatedAt: 100, thinking: false },
            { updatedAt: 100, assistantMessageId: 'm1' },
        )).toBe(false)
    })
})

describe('resolveOrbShapeKind', () => {
    it('uses cube for permission', () => {
        expect(resolveOrbShapeKind(makeSession({ pendingRequestKinds: ['permission'] }), false)).toBe('cube')
    })

    it('uses octahedron for attention', () => {
        expect(resolveOrbShapeKind(makeSession(), true)).toBe('octahedron')
    })

    it('uses icosahedron while thinking', () => {
        expect(resolveOrbShapeKind(makeSession({ thinking: true }), false)).toBe('icosahedron')
    })
})

describe('gardenSeenStore', () => {
    beforeEach(() => {
        clearGardenSeenForTests()
    })

    it('stores and reads seen records', () => {
        markGardenSeen('a', 50, 'msg-1')
        expect(getGardenSeen('a')).toEqual({ updatedAt: 50, assistantMessageId: 'msg-1' })
    })
})

describe('attentionReasonForSession', () => {
    it('returns permission when queue non-empty', () => {
        expect(attentionReasonForSession({ pendingRequestKinds: ['permission', 'input'] })).toBe('permission')
    })
})
