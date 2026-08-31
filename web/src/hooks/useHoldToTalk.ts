import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'

type UseHoldToTalkOptions = {
    /** Fires immediately on press-down, before the threshold timer — start any async prep (e.g. acquiring a mic stream) that a confirmed hold will need, without waiting to find out whether this becomes one. */
    onPressStart?: () => void
    /** Fires once the press threshold is reached while still held — begin recording. */
    onHoldStart: () => void
    /** Fires when a hold that reached the threshold ends — release, cancel, or drag-off. Release IS the stop-and-apply action; there is no separate confirm step. */
    onHoldEnd: () => void
    /** Fires whenever a press ends WITHOUT ever reaching the threshold — tap, drag-off, cancel, or leave. Use this to discard/abort whatever onPressStart began; onTap (below) additionally fires only for a clean quick release, not a drag. */
    onPressEnd?: () => void
    /** Fires for a press that released before the threshold with no drag — a plain tap/click. */
    onTap: () => void
    threshold?: number
    disabled?: boolean
}

type UseHoldToTalkHandlers = {
    onTouchStart: React.TouchEventHandler
    onTouchEnd: React.TouchEventHandler
    onTouchMove: React.TouchEventHandler
    onTouchCancel: React.TouchEventHandler
    onMouseDown: React.MouseEventHandler
    onMouseUp: React.MouseEventHandler
    onMouseLeave: React.MouseEventHandler
    onClick: React.MouseEventHandler
}

// Distance a press may drift before a still-pending hold is treated as a drag
// (e.g. the start of a scroll) rather than an intentional press-and-hold.
const MOVE_CANCEL_PX = 12

// Touch browsers emit a compatibility mousedown/mouseup/click a beat after a
// real touch ends; without this window a single tap could re-trigger the
// whole gesture a second time via the synthesized mouse events.
const GHOST_MOUSE_WINDOW_MS = 700

// Push-to-talk on both touch and mouse: hold past the threshold to start,
// release to stop — release is both the stop and the commit, there is no
// separate button. Keyboard/assistive activation (detail === 0) stays a
// plain tap, matching native button semantics.
export function useHoldToTalk(options: UseHoldToTalkOptions): UseHoldToTalkHandlers {
    const { onPressStart, onHoldStart, onHoldEnd, onPressEnd, onTap, threshold = 500, disabled = false } = options

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const holdingRef = useRef(false)
    const draggedRef = useRef(false)
    const startPointRef = useRef({ x: 0, y: 0 })
    const lastTouchAtRef = useRef(0)

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    // Ends an in-progress press. If it had reached confirmed-hold, finalize
    // via onHoldEnd; otherwise it never became one (tap, drag-off, cancel, or
    // leave before the threshold) — onPressEnd lets the caller discard
    // whatever onPressStart began. Safe to call unconditionally.
    const endHold = useCallback(() => {
        clearTimer()
        if (holdingRef.current) {
            holdingRef.current = false
            onHoldEnd()
        } else {
            onPressEnd?.()
        }
    }, [clearTimer, onHoldEnd, onPressEnd])

    useEffect(() => () => clearTimer(), [clearTimer])

    const startPending = useCallback((x: number, y: number) => {
        clearTimer()
        draggedRef.current = false
        startPointRef.current = { x, y }
        onPressStart?.()
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            holdingRef.current = true
            onHoldStart()
        }, threshold)
    }, [clearTimer, threshold, onHoldStart, onPressStart])

    const checkDrift = useCallback((x: number, y: number) => {
        // Once recording has actually started there is nothing to cancel —
        // ignore drift entirely so a natural hand tremor (or, for a real
        // touch, the fact that it keeps the same target regardless of where
        // the finger currently is) doesn't cut a genuine hold short.
        if (holdingRef.current) return
        const dx = x - startPointRef.current.x
        const dy = y - startPointRef.current.y
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
            draggedRef.current = true
            clearTimer()
        }
    }, [clearTimer])

    const release = useCallback(() => {
        const wasHolding = holdingRef.current
        endHold()
        if (!wasHolding && !draggedRef.current) onTap()
    }, [endHold, onTap])

    // True when a mouse event is actually a touch-synthesized compatibility
    // event firing right after a tap; such events must not re-trigger the gesture.
    const isGhostMouseEvent = useCallback(
        () => Date.now() - lastTouchAtRef.current < GHOST_MOUSE_WINDOW_MS,
        []
    )

    const onTouchStart = useCallback<React.TouchEventHandler>((e) => {
        lastTouchAtRef.current = Date.now()
        if (disabled) return
        const touch = e.touches[0]
        if (touch) startPending(touch.clientX, touch.clientY)
    }, [disabled, startPending])

    const onTouchMove = useCallback<React.TouchEventHandler>((e) => {
        const touch = e.touches[0]
        if (touch) checkDrift(touch.clientX, touch.clientY)
    }, [checkDrift])

    const onTouchEnd = useCallback<React.TouchEventHandler>((e) => {
        lastTouchAtRef.current = Date.now()
        // Suppress the browser's compatibility click so a plain tap does not
        // fire onTap twice (once here, once via the native onClick below).
        e.preventDefault()
        release()
    }, [release])

    const onTouchCancel = useCallback<React.TouchEventHandler>(() => {
        endHold()
    }, [endHold])

    const onMouseDown = useCallback<React.MouseEventHandler>((e) => {
        if (e.button !== 0) return
        if (disabled || isGhostMouseEvent()) return
        startPending(e.clientX, e.clientY)
    }, [disabled, isGhostMouseEvent, startPending])

    const onMouseUp = useCallback<React.MouseEventHandler>(() => {
        if (isGhostMouseEvent()) return
        release()
    }, [isGhostMouseEvent, release])

    const onMouseLeave = useCallback<React.MouseEventHandler>(() => {
        // Mouse events don't keep their original target once the pointer
        // moves off the element (unlike touch), so a mouseup outside the
        // button would never reach onMouseUp — end here instead. This is
        // never a tap: endHold() only fires onHoldEnd if a hold had actually
        // started, and silently cancels an unstarted pending press otherwise.
        if (isGhostMouseEvent()) return
        endHold()
    }, [isGhostMouseEvent, endHold])

    const onClick = useCallback<React.MouseEventHandler>((e) => {
        if (disabled) return
        // Real mouse/touch clicks are already handled by the mousedown+mouseup
        // / touchstart+touchend pairs above; only keyboard and assistive
        // activation (detail 0) reaches the browser's click without one.
        if (e.detail === 0) onTap()
    }, [disabled, onTap])

    return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel, onMouseDown, onMouseUp, onMouseLeave, onClick }
}
