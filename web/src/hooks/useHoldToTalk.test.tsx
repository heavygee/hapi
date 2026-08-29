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

    it('fires onTap for keyboard/assistive activation (click with no mousedown/up pair)', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.click(button, { detail: 0 })

        expect(onTap).toHaveBeenCalledOnce()
        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onHoldEnd).not.toHaveBeenCalled()
    })

    it('ignores a synthesized click that follows a real mouse press — no double onTap', () => {
        // A genuine mouse click always fires `click` (detail >= 1) right after
        // mouseup; the tap/hold decision is already made by the mousedown+
        // mouseup pair, so onClick must not also fire onTap for it.
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 })
        act(() => {
            vi.advanceTimersByTime(200)
        })
        fireEvent.mouseUp(button, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.click(button, { detail: 1 })

        expect(onTap).toHaveBeenCalledOnce()
    })

    it('starts and stops dictation on a mouse press-and-hold, same as touch', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 })
        expect(onHoldStart).not.toHaveBeenCalled()
        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(onHoldStart).toHaveBeenCalledOnce()

        fireEvent.mouseUp(button, { button: 0, clientX: 10, clientY: 10 })

        expect(onHoldEnd).toHaveBeenCalledOnce()
        expect(onTap).not.toHaveBeenCalled()
    })

    it('ignores non-left mouse buttons (right/middle click)', () => {
        const onHoldStart = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={vi.fn()} onTap={vi.fn()} />)
        const button = getByTestId('talk')

        fireEvent.mouseDown(button, { button: 2, clientX: 10, clientY: 10 })
        act(() => {
            vi.advanceTimersByTime(500)
        })

        expect(onHoldStart).not.toHaveBeenCalled()
    })

    it('ends the hold when the mouse leaves the button — mouseup outside would otherwise never arrive', () => {
        const onHoldStart = vi.fn()
        const onHoldEnd = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(onHoldStart).toHaveBeenCalledOnce()

        fireEvent.mouseLeave(button)

        expect(onHoldEnd).toHaveBeenCalledOnce()
        expect(onTap).not.toHaveBeenCalled()
    })

    it('cancels a pending mouse press on mouseleave before the threshold — not a tap', () => {
        const onHoldStart = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={vi.fn()} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.mouseLeave(button)
        act(() => {
            vi.advanceTimersByTime(500)
        })

        expect(onHoldStart).not.toHaveBeenCalled()
        expect(onTap).not.toHaveBeenCalled()
    })

    it('suppresses the ghost mousedown/mouseup that follows a real touch tap', () => {
        const onHoldStart = vi.fn()
        const onTap = vi.fn()
        const { getByTestId } = render(<Probe onHoldStart={onHoldStart} onHoldEnd={vi.fn()} onTap={onTap} />)
        const button = getByTestId('talk')

        fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] })
        fireEvent.touchEnd(button, { changedTouches: [{ clientX: 10, clientY: 10 }] })
        expect(onTap).toHaveBeenCalledOnce()

        // Browser-synthesized compatibility mouse events for the same tap.
        fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.mouseUp(button, { button: 0, clientX: 10, clientY: 10 })

        expect(onTap).toHaveBeenCalledOnce()
        expect(onHoldStart).not.toHaveBeenCalled()
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
