import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    OPERATOR_DOCK_PREF_KEY,
    OPERATOR_DOCK_SECRET_KEY,
    applyOperatorDockVisibility,
    disableOperatorDockFromSettings,
    enableOperatorDockFromSettings,
    isOperatorDockKnock,
    isOperatorDockPrefEnabled,
    persistOperatorDockKnock,
    shouldBootOperatorDock
} from './operator-dock-pref'

describe('operator dock visibility pref (host, not vendored dock)', () => {
    beforeEach(() => {
        localStorage.clear()
        document.documentElement.removeAttribute('data-hapi-operator-dock')
    })

    it('defaults off and does not boot without knock or pref', () => {
        expect(isOperatorDockPrefEnabled()).toBe(false)
        expect(shouldBootOperatorDock('/sessions', '')).toBe(false)
    })

    it('treats /opmic aliases as knocks and never /hapi', () => {
        expect(isOperatorDockKnock('/opmic')).toBe(true)
        expect(isOperatorDockKnock('/mic')).toBe(true)
        expect(isOperatorDockKnock('/unlock')).toBe(true)
        expect(isOperatorDockKnock('/sessions', '?opmic=1')).toBe(true)
        expect(isOperatorDockKnock('/hapi')).toBe(false)
        expect(isOperatorDockKnock('/api/sessions')).toBe(false)
    })

    it('persists knock so later routes boot the dock', () => {
        persistOperatorDockKnock('/opmic', '')
        expect(localStorage.getItem(OPERATOR_DOCK_PREF_KEY)).toBe('true')
        expect(isOperatorDockPrefEnabled()).toBe(true)
        expect(shouldBootOperatorDock('/sessions', '')).toBe(true)
    })

    it('enable from Settings prompts for the gate secret and stores the dock key', () => {
        const prompt = vi.fn(() => 'gate-secret')
        expect(enableOperatorDockFromSettings(prompt)).toBe(true)
        expect(prompt).toHaveBeenCalledOnce()
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBe('gate-secret')
        expect(isOperatorDockPrefEnabled()).toBe(true)
        expect(document.documentElement.getAttribute('data-hapi-operator-dock')).toBe('on')
    })

    it('enable from Settings does not persist when the prompt is cancelled', () => {
        expect(enableOperatorDockFromSettings(() => null)).toBe(false)
        expect(isOperatorDockPrefEnabled()).toBe(false)
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBeNull()
    })

    it('skips the prompt when the dock secret is already stored', () => {
        localStorage.setItem(OPERATOR_DOCK_SECRET_KEY, 'already')
        const prompt = vi.fn()
        expect(enableOperatorDockFromSettings(prompt)).toBe(true)
        expect(prompt).not.toHaveBeenCalled()
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBe('already')
    })

    it('disable hides the dock but keeps the secret', () => {
        localStorage.setItem(OPERATOR_DOCK_SECRET_KEY, 'keep-me')
        enableOperatorDockFromSettings(() => 'unused')
        disableOperatorDockFromSettings()
        expect(isOperatorDockPrefEnabled()).toBe(false)
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBe('keep-me')
        expect(document.documentElement.getAttribute('data-hapi-operator-dock')).toBe('off')
        expect(shouldBootOperatorDock('/sessions', '')).toBe(false)
        expect(shouldBootOperatorDock('/opmic', '')).toBe(true)
    })

    it('applyOperatorDockVisibility sets the host data attribute', () => {
        applyOperatorDockVisibility(true)
        expect(document.documentElement.getAttribute('data-hapi-operator-dock')).toBe('on')
        applyOperatorDockVisibility(false)
        expect(document.documentElement.getAttribute('data-hapi-operator-dock')).toBe('off')
    })
})
