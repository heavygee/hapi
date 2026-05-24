import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SessionSummary } from '@/types/api'
import { useGardenAttention, FIRST_ATTENTION_CUE_MS } from '@/garden/hooks/useGardenAttention'

const useXRMock = vi.fn()

vi.mock('@react-three/xr', () => ({
    useXR: (selector: (state: { session?: object }) => unknown) => selector(useXRMock()),
}))

function makeSession(id: string): SessionSummary {
    return {
        id,
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        model: null,
        effort: null,
    }
}

describe('useGardenAttention', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        useXRMock.mockReturnValue({ session: undefined })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    it('does not seek when flat (no XR session)', () => {
        const sessions = [makeSession('a'), makeSession('b')]
        const { result } = renderHook(() => useGardenAttention(sessions))

        act(() => {
            vi.advanceTimersByTime(10_000)
        })

        expect(result.current.seekingId).toBeNull()
    })

    it('starts attention loop after initial delay in VR', () => {
        useXRMock.mockReturnValue({ session: {} })
        const sessions = [makeSession('a'), makeSession('b')]
        const { result } = renderHook(() => useGardenAttention(sessions))

        act(() => {
            vi.advanceTimersByTime(FIRST_ATTENTION_CUE_MS)
        })

        expect(['a', 'b']).toContain(result.current.seekingId)
    })

    it('does not reset the timer when session rows refresh with the same ids', () => {
        useXRMock.mockReturnValue({ session: {} })
        const initial = [makeSession('a')]
        const { result, rerender } = renderHook(
            ({ list }: { list: SessionSummary[] }) => useGardenAttention(list),
            { initialProps: { list: initial } }
        )

        act(() => {
            vi.advanceTimersByTime(FIRST_ATTENTION_CUE_MS - 200)
        })

        rerender({
            list: [{ ...makeSession('a'), updatedAt: 99_999, thinking: true }],
        })

        act(() => {
            vi.advanceTimersByTime(250)
        })

        expect(result.current.seekingId).toBe('a')
    })

    it('clears seeking when leaving VR', () => {
        useXRMock.mockReturnValue({ session: {} })
        const sessions = [makeSession('a')]
        const { result, rerender } = renderHook(() => useGardenAttention(sessions))

        act(() => {
            vi.advanceTimersByTime(FIRST_ATTENTION_CUE_MS)
        })
        expect(result.current.seekingId).toBe('a')

        useXRMock.mockReturnValue({ session: undefined })
        rerender()

        expect(result.current.seekingId).toBeNull()
    })

    it('playCue sets seeking id immediately', () => {
        const sessions = [makeSession('a')]
        const { result } = renderHook(() => useGardenAttention(sessions))

        act(() => {
            result.current.playCue('a')
        })

        expect(result.current.seekingId).toBe('a')
    })
})
