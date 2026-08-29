import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useHoldToTalk } from './useHoldToTalk'

function Probe(props: { onHoldStart: () => void; onHoldEnd: () => void; onTap: () => void }) {
    const handlers = useHoldToTalk(props)
    return (
        <button type="button" data-testid="talk" {...handlers}>
            talk
        </button>
    )
}

describe('useHoldToTalk', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    it('fires onTap for a quick touch tap, never onHoldStart/onHoldEnd', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        act(() => {
            vi.advanceTimersByTime(200)
        })
        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 10, clientY: 10 }] })

        expect(onTap).toHaveBeenCalledOnce()
        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onHoldEnd).not.toHaveBeenCalled()
    })

    it('fires onHoldStart at the threshold and onHoldEnd on release — release is the only stop', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        expect(onHoldStart).not.toHaveBeenCalled()
        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(onHoldStart).toHaveBeenCalledOnce()
        expect(onHoldEnd).not.toHaveBeenCalled()

        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 10, clientY: 10 }] })

        expect(onHoldEnd).toHaveBeenCalledOnce()
        expect(onTap).not.toHaveBeenCalled()
    })

    it('does not require a second interaction to stop — no separate confirm/stop step exists', () => {
        // There is deliberately no "stop" handler exposed by the hook at all:
        // release IS the stop. This test exists to pin that contract down.
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 10, clientY: 10 }] })

        expect(onHoldStart).toHaveBeenCalledOnce()
        expect(onHoldEnd).toHaveBeenCalledOnce()
    })

    it('treats touchcancel after a started hold as a release (onHoldEnd fires)', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        fireEvent.touchCancel(button)

        expect(onHoldStart).toHaveBeenCalledOnce()
        expect(onHoldEnd).toHaveBeenCalledOnce()
    })

    it('cancels a pending hold on touchcancel before the threshold — no onHoldStart', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        fireEvent.touchCancel(button)
        act(() => {
            vi.advanceTimersByTime(500)
        })

        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onHoldEnd).not.toHaveBeenCalled()
    })

    it('cancels a pending hold on drag before the threshold and does not treat it as a tap', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        fireEvent.touchMove(button, { touches: [{ clientX: 10, clientY: 40 }] })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 10, clientY: 40 }] })

        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onTap).not.toHaveBeenCalled()
    })

    it('ignores finger drift once a hold has actually started — a real touch keeps its original target', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        // Large drift after the hold has started must not cancel the recording.
        fireEvent.touchMove(button, { touches: [{ clientX: 500, clientY: 500 }] })
        expect(onHoldEnd).not.toHaveBeenCalled()

        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 500, clientY: 500 }] })
        expect(onHoldStart).toHaveBeenCalledOnce()
        expect(onHoldEnd).toHaveBeenCalledOnce()
    })

    it('fires onTap for a mouse click and never engages the hold gesture', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.click(button)

        expect(onTap).toHaveBeenCalledOnce()
        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onHoldEnd).not.toHaveBeenCalled()
    })

    it('cleans up the pending threshold timer on unmount', () => {
        const onHoldStart = vi.fn()
        const { getByTestId, unmount } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={vi.fn()} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        expect(vi.getTimerCount()).toBe(1)

        unmount()

        expect(vi.getTimerCount()).toBe(0)
        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(onHoldStart).not.toHaveBeenCalled()
    })
})
