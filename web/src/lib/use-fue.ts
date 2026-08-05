import { useCallback, useEffect, useState } from 'react'

/**
 * useFue — generic First-User-Experience badge / callout state machine.
 *
 * Goal: any new feature can advertise itself with a small dot on its
 * affordance; the dot disappears for good once the user has engaged
 * with it AND explicitly acknowledged the explainer. Hover surfaces a
 * tooltip (caller's responsibility); click triggers `engage()`, which
 * flips status to 'engaging' and renders the callout. Auto-timeout is
 * deliberately not provided — reading speed varies, and a popover that
 * disappears on its own undercuts the affirmative-action model.
 *
 * Storage:  hapi.fue.v1.<featureId>  ('1' once acknowledged, absent otherwise)
 *
 * Status machine:
 *   unseen        — initial. Badge visible, callout primed.
 *   engaging      — operator has clicked the affordance for the first time.
 *                   Callout is showing; awaiting explicit dismiss.
 *   acknowledged  — terminal. Persisted to localStorage. Badge + callout
 *                   suppressed forever (until storage is cleared).
 *
 * Independence from any upstream FUE: the storage namespace is
 * `hapi.fue.v1.*` and feature IDs are caller-defined. If upstream/tiann
 * adds a different onboarding flow that uses other keys / mechanisms,
 * this system stays out of the way (caller decides whether to wrap a
 * given affordance with FUE or not).
 *
 * Global opt-out: `hapi.fue.v1.disabled` (a reserved featureId-shaped key
 * under the same prefix) suppresses every `useFue()` instance at once —
 * shell-tour steps (see use-onboarding-tour.ts) and per-feature dots alike.
 * Reachable either from Settings → General or from the "don't show tips
 * like this again" link on any single FueCallout — operators who don't
 * want to be onboarded shouldn't have to dismiss every dot one at a time.
 */

const STORAGE_PREFIX = 'hapi.fue.v1.'
const DISABLE_ALL_KEY = STORAGE_PREFIX + 'disabled'

export type FueStatus = 'unseen' | 'engaging' | 'acknowledged'

export function isFueDisabledGlobally(): boolean {
    if (typeof window === 'undefined') return false
    try {
        return window.localStorage.getItem(DISABLE_ALL_KEY) === '1'
    } catch {
        return false
    }
}

/** Suppress every current and future FUE (shell tour + feature dots). */
export function disableAllFue(): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(DISABLE_ALL_KEY, '1')
    } catch {
        // ignore
    }
}

/** Re-enable FUE globally (Settings toggle flipped back on). */
export function enableAllFue(): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.removeItem(DISABLE_ALL_KEY)
    } catch {
        // ignore
    }
}

function readAcknowledged(featureId: string): boolean {
    if (typeof window === 'undefined') return false
    if (isFueDisabledGlobally()) return true
    try {
        return window.localStorage.getItem(STORAGE_PREFIX + featureId) === '1'
    } catch {
        return false
    }
}

function writeAcknowledged(featureId: string): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(STORAGE_PREFIX + featureId, '1')
    } catch {
        // localStorage may be unavailable (private mode, quota). Non-fatal:
        // worst case the user sees the badge again next session.
    }
}

export function useFue(featureId: string): {
    status: FueStatus
    /** Call this on the first user-initiated engagement (typically the
     *  affordance's onClick). No-op if already engaging or acknowledged. */
    engage: () => void
    /** Acknowledge permanently (call from the callout's "Got it" button or
     *  any other explicit affirmative action). */
    dismiss: () => void
} {
    const [status, setStatus] = useState<FueStatus>(() =>
        readAcknowledged(featureId) ? 'acknowledged' : 'unseen'
    )

    // Re-read on featureId change (different feature, different state).
    useEffect(() => {
        setStatus(readAcknowledged(featureId) ? 'acknowledged' : 'unseen')
    }, [featureId])

    const engage = useCallback(() => {
        if (isFueDisabledGlobally()) {
            setStatus('acknowledged')
            return
        }
        setStatus((prev) => (prev === 'unseen' ? 'engaging' : prev))
    }, [])

    const dismiss = useCallback(() => {
        writeAcknowledged(featureId)
        setStatus('acknowledged')
    }, [featureId])

    return { status, engage, dismiss }
}

/**
 * Test / dev-tool helper: clear acknowledgement for a feature so the FUE
 * badge re-appears. Not used at runtime; expose via window for manual QA:
 *
 *   localStorage.removeItem('hapi.fue.v1.scratchlist-toggle')
 *
 * Or call from a dev console: resetFue('scratchlist-toggle').
 */
export function resetFue(featureId: string): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.removeItem(STORAGE_PREFIX + featureId)
    } catch {
        // ignore
    }
}
