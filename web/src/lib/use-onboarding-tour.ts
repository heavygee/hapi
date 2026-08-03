import { useCallback, useEffect, useState } from 'react'
import { isFueDisabledGlobally } from './use-fue'

/**
 * useOnboardingTour — app-shell first-run guided walk, distinct from the
 * per-feature dots in use-fue.ts.
 *
 * Relationship to useFue: a feature FUE (scratchlist, composer terminal)
 * waits for the operator to *reach* that affordance, then reveals itself
 * on click. The shell tour is the opposite shape — it runs unprompted,
 * once, on the very first visit, to point at 3 primary affordances on the
 * /sessions screen (new session, browse, settings) before the operator
 * has necessarily clicked anything. Both respect the same global kill
 * switch (`isFueDisabledGlobally`), so turning off FUE turns off the tour
 * too.
 *
 * Scoped to /sessions only: desktop shows the session list and its detail
 * pane side by side, but mobile is single-pane (selecting a session
 * replaces the list in the DOM). A tour step anchored to a sidebar button
 * would have nothing to anchor to once the operator navigates into a
 * session on mobile, so the tour never tries to follow them there — the
 * composer-terminal FUE covers that "deeper" affordance instead,
 * just-in-time, once the operator reaches it naturally. Not every deeper
 * affordance needs a FUE, though: if the UI already explains itself
 * inline (e.g. Create Session's "Worktree" option has an always-visible
 * description), wrapping it in a click-to-reveal FUE only adds friction.
 *
 * Storage: hapi.onboarding.v1.shell-tour ('1' once finished/skipped/
 * silently pre-acknowledged for an upgrading user, absent otherwise).
 */

const ACK_KEY = 'hapi.onboarding.v1.shell-tour'

export const SHELL_TOUR_STEPS = ['new-session', 'browse', 'settings'] as const
export type ShellTourStepId = typeof SHELL_TOUR_STEPS[number]

function readAck(): boolean {
    if (typeof window === 'undefined') return false
    try {
        return window.localStorage.getItem(ACK_KEY) === '1'
    } catch {
        return false
    }
}

function writeAck(): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(ACK_KEY, '1')
    } catch {
        // localStorage may be unavailable — worst case the tour offers
        // itself again next visit, same trade-off as use-fue.ts.
    }
}

export function useOnboardingTour(params: { sessionCount: number; sessionsLoaded: boolean }): {
    /** Current step to spotlight, or null if the tour isn't running. */
    activeStepId: ShellTourStepId | null
    isLastStep: boolean
    /** Advance to the next step, or finish the tour on the last one. */
    next: () => void
    /** Bail out of the tour entirely — same terminal state as finishing it. */
    skipAll: () => void
} {
    const [stepIndex, setStepIndex] = useState<number | null>(null)
    const [decided, setDecided] = useState(false)

    useEffect(() => {
        if (decided || !params.sessionsLoaded) return
        if (isFueDisabledGlobally() || readAck()) {
            setDecided(true)
            return
        }
        if (params.sessionCount === 0) {
            // New install (or first load after clearing storage): offer the tour.
            setStepIndex(0)
        } else {
            // Upgrading operator with existing usage — never interrupt them
            // with a tour explaining a shell they already know.
            writeAck()
        }
        setDecided(true)
    }, [decided, params.sessionCount, params.sessionsLoaded])

    const finish = useCallback(() => {
        writeAck()
        setStepIndex(null)
    }, [])

    const next = useCallback(() => {
        setStepIndex((prev) => {
            if (prev === null) return prev
            if (prev >= SHELL_TOUR_STEPS.length - 1) {
                writeAck()
                return null
            }
            return prev + 1
        })
    }, [])

    return {
        activeStepId: stepIndex === null ? null : SHELL_TOUR_STEPS[stepIndex],
        isLastStep: stepIndex !== null && stepIndex === SHELL_TOUR_STEPS.length - 1,
        next,
        skipAll: finish,
    }
}
