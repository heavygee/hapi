import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { clearGardenSeenForTests } from '@/garden/store/gardenSeenStore'
import { renderHook } from '@testing-library/react'
import type { SessionSummary } from '@/types/api'
import { markGardenSeen } from '@/garden/store/gardenSeenStore'
import { useGardenAttention } from '@/garden/hooks/useGardenAttention'

const useXRMock = vi.fn()

vi.mock('@react-three/xr', () => ({
    useXR: (selector: (state: { session?: object }) => unknown) => selector(useXRMock()),
}))

function makeSession(
    id: string,
    overrides: Partial<SessionSummary> = {},
): SessionSummary {
    return {
        id,
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
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

describe('useGardenAttention', () => {
    beforeEach(() => {
        clearGardenSeenForTests()
        useXRMock.mockReturnValue({ session: undefined })
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('does not mark attention when flat', () => {
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"] })], focus: null })

        expect(result.current.attentionIds.size).toBe(0)
    })

    it('seeds sticky attention from unseen state on VR enter', () => {
        useXRMock.mockReturnValue({ session: {} })
        markGardenSeen('a', 5, null)
        const initial = [makeSession('a', { updatedAt: 50, pendingRequestKinds: [] })]
        const { result } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        expect(result.current.attentionIds.has('a')).toBe(true)
        expect(result.current.attentionCueTokens.a ?? 0).toBe(0)
    })

    it('marks attention on permission in VR and keeps it sticky', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"], updatedAt: 10 })], focus: null })
        expect(result.current.attentionIds.has('a')).toBe(true)

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"], updatedAt: 11 })], focus: null })
        expect(result.current.attentionIds.has('a')).toBe(true)
    })

    it('does not ping the voice-focused session', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: 'a' as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"] })], focus: 'a' })

        expect(result.current.attentionIds.has('a')).toBe(false)
    })

    it('clears permission attention after focus and queue drained', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"], updatedAt: 10 })], focus: null })
        expect(result.current.attentionIds.has('a')).toBe(true)

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"], updatedAt: 10 })], focus: 'a' })
        expect(result.current.attentionIds.has('a')).toBe(true)

        rerender({ list: [makeSession('a', { pendingRequestKinds: [], updatedAt: 10 })], focus: 'a' })
        expect(result.current.attentionIds.has('a')).toBe(false)
    })

    it('clears ready attention after focus and session update', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a', { thinking: true, updatedAt: 5 })]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { thinking: false, updatedAt: 10 })], focus: null })
        expect(result.current.attentionIds.has('a')).toBe(true)

        rerender({ list: [makeSession('a', { thinking: false, updatedAt: 10 })], focus: 'a' })
        expect(result.current.attentionIds.has('a')).toBe(true)

        rerender({ list: [makeSession('a', { thinking: false, updatedAt: 11 })], focus: 'a' })
        expect(result.current.attentionIds.has('a')).toBe(false)
    })

    it('bumps cue token on each ping', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"] })], focus: null })
        expect(result.current.attentionCueTokens.a).toBe(1)

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission", "input"] })], focus: null })
        expect(result.current.attentionCueTokens.a).toBe(2)
    })

    it('clears attention when leaving VR', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list, focus }) => useGardenAttention(list, focus),
            { initialProps: { list: initial, focus: null as string | null } },
        )

        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"] })], focus: null })
        expect(result.current.attentionIds.has('a')).toBe(true)

        useXRMock.mockReturnValue({ session: undefined })
        rerender({ list: [makeSession('a', { pendingRequestKinds: ["permission"] })], focus: null })

        expect(result.current.attentionIds.has('a')).toBe(false)
    })
})
