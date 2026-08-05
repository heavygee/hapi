import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { disableAllFue } from './use-fue'
import { SHELL_TOUR_STEPS, useOnboardingTour } from './use-onboarding-tour'

const ACK_KEY = 'hapi.onboarding.v1.shell-tour'

describe('useOnboardingTour', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('does nothing until sessions have loaded', () => {
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: false }))
        expect(result.current.activeStepId).toBeNull()
        expect(localStorage.getItem(ACK_KEY)).toBeNull()
    })

    it('starts the tour at the first step for a brand-new install (zero sessions, no ack)', () => {
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBe(SHELL_TOUR_STEPS[0])
    })

    it('silently pre-acknowledges an upgrading operator with existing sessions — never interrupts them', () => {
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 5, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBeNull()
        expect(localStorage.getItem(ACK_KEY)).toBe('1')
    })

    it('stays inactive once already acknowledged, regardless of session count', () => {
        localStorage.setItem(ACK_KEY, '1')
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBeNull()
    })

    it('respects the global FUE disable flag and does not write its own ack', () => {
        disableAllFue()
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBeNull()
        expect(localStorage.getItem(ACK_KEY)).toBeNull()
    })

    it('next() walks through all steps in order, then finishes and persists', () => {
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBe('new-session')
        expect(result.current.isLastStep).toBe(false)

        act(() => result.current.next())
        expect(result.current.activeStepId).toBe('browse')

        act(() => result.current.next())
        expect(result.current.activeStepId).toBe('settings')
        expect(result.current.isLastStep).toBe(true)

        act(() => result.current.next())
        expect(result.current.activeStepId).toBeNull()
        expect(localStorage.getItem(ACK_KEY)).toBe('1')
    })

    it('skipAll() ends the tour immediately from any step and persists', () => {
        const { result } = renderHook(() => useOnboardingTour({ sessionCount: 0, sessionsLoaded: true }))
        expect(result.current.activeStepId).toBe('new-session')

        act(() => result.current.skipAll())
        expect(result.current.activeStepId).toBeNull()
        expect(localStorage.getItem(ACK_KEY)).toBe('1')
    })
})
