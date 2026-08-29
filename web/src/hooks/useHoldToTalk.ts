import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'

type UseHoldToTalkOptions = {
    /** Fires once the press threshold is reached while still held — begin recording. */
    onHoldStart: () => void
    /** Fires when a hold that reached the threshold ends — release, cancel, or drag-off. Release IS the stop-and-apply action; there is no separate confirm step. */
    onHoldEnd: () => void
    /** Fires for a touch that released before the threshold — a plain tap. */
    onTap: () => void
    threshold?: number
    disabled?: boolean
}

type UseHoldToTalkHandlers = {
    onTouchStart: React.TouchEventHandler
    onTouchEnd: React.TouchEventHandler
    onTouchMove: React.TouchEventHandler
    onTouchCancel: React.TouchEventHandler
    onClick: React.MouseEventHandler
}

// Distance a touch may drift before a still-pending hold is treated as a drag
// (e.g. the start of a scroll) rather than an intentional press-and-hold.
const MOVE_CANCEL_PX = 12

// Touch-only push-to-talk: hold past the threshold to start, release to stop
// — release is both the stop and the commit, there is no separate button.
// Mouse/keyboard activation stays a plain tap (onClick) so desktop and a11y
// behavior is unaffected; only real touches can trigger the hold gesture.
export function useHoldToTalk(options: UseHoldToTalkOptions): UseHoldToTalkHandlers {
    const { onHoldStart, onHoldEnd, onTap, threshold = 500, disabled = false } = options

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const holdingRef = useRef(false)
    const draggedRef = useRef(false)
    const startPointRef = useRef({ x: 0, y: 0 })

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    // Ends an in-progress hold. Safe to call even when nothing is holding —
    // touchend after a plain tap, or touchcancel with no prior hold-start.
    const endHold = useCallback(() => {
        clearTimer()
        if (holdingRef.current) {
            holdingRef.current = false
            onHoldEnd()
        }
    }, [clearTimer, onHoldEnd])

    useEffect(() => () => clearTimer(), [clearTimer])

    const onTouchStart = useCallback<React.TouchEventHandler>((e) => {
        if (disabled) return
        clearTimer()
        draggedRef.current = false
        const touch = e.touches[0]
        if (touch) startPointRef.current = { x: touch.clientX, y: touch.clientY }
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            holdingRef.current = true
            onHoldStart()
        }, threshold)
    }, [disabled, clearTimer, threshold, onHoldStart])

    const onTouchMove = useCallback<React.TouchEventHandler>((e) => {
        // A real touch keeps the same target for its whole lifetime regardless
        // of where the finger currently is, so once recording has actually
        // started there is nothing to cancel here — ignore drift entirely so a
        // natural hand tremor doesn't cut a genuine hold short.
        if (holdingRef.current) return
        const touch = e.touches[0]
        if (!touch) return
        const dx = touch.clientX - startPointRef.current.x
        const dy = touch.clientY - startPointRef.current.y
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
            draggedRef.current = true
            clearTimer()
        }
    }, [clearTimer])

    const onTouchEnd = useCallback<React.TouchEventHandler>((e) => {
        // Suppress the browser's compatibility click so a plain tap does not
        // fire onTap twice (once here, once via the native onClick below).
        e.preventDefault()
        const wasHolding = holdingRef.current
        endHold()
        if (!wasHolding && !draggedRef.current) onTap()
    }, [endHold, onTap])

    const onTouchCancel = useCallback<React.TouchEventHandler>(() => {
        endHold()
    }, [endHold])

    const onClick = useCallback<React.MouseEventHandler>(() => {
        if (disabled) return
        onTap()
    }, [disabled, onTap])

    return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel, onClick }
}
