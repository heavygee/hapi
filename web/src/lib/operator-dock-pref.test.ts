import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    OPERATOR_DOCK_HUB_AUTH_ALERT,
    OPERATOR_DOCK_MISMATCH_ALERT,
    OPERATOR_DOCK_PREF_KEY,
    OPERATOR_DOCK_PROMPT,
    OPERATOR_DOCK_SECRET_KEY,
    applyOperatorDockVisibility,
    classifyOperatorDockProbe,
    disableOperatorDockFromSettings,
    enableOperatorDockFromSettings,
    isOperatorDockKnock,
    isOperatorDockPrefEnabled,
    persistOperatorDockKnock,
    probeOperatorDockSecret,
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

    it('classifies gate mismatch vs hub auth vs path forbidden', () => {
        expect(classifyOperatorDockProbe(403, 'operator secret required', 'gate_secret_mismatch')).toBe('mismatch')
        expect(classifyOperatorDockProbe(401, 'Missing authorization token', '')).toBe('hub_auth')
        expect(classifyOperatorDockProbe(401, 'hub JWT missing', 'hub_auth_missing')).toBe('hub_auth')
        expect(classifyOperatorDockProbe(403, 'path not allowed through operator proxy', 'proxy_path_forbidden')).toBe('forbidden')
    })

    it('enable from Settings probes the gate secret before persisting', async () => {
        const prompt = vi.fn(() => 'gate-secret')
        const alert = vi.fn()
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }))
        expect(await enableOperatorDockFromSettings(prompt, alert, fetchImpl as unknown as typeof fetch)).toBe(true)
        expect(prompt).toHaveBeenCalledWith(OPERATOR_DOCK_PROMPT)
        expect(fetchImpl).toHaveBeenCalled()
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBe('gate-secret')
        expect(isOperatorDockPrefEnabled()).toBe(true)
        expect(document.documentElement.getAttribute('data-hapi-operator-dock')).toBe('on')
        expect(alert).not.toHaveBeenCalled()
    })

    it('enable from Settings does not persist when the prompt is cancelled', async () => {
        expect(await enableOperatorDockFromSettings(() => null, vi.fn(), vi.fn() as unknown as typeof fetch)).toBe(false)
        expect(isOperatorDockPrefEnabled()).toBe(false)
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBeNull()
    })

    it('re-prompts when a stored gate secret mismatches the hub', async () => {
        localStorage.setItem(OPERATOR_DOCK_SECRET_KEY, 'stale-wrong')
        const prompt = vi.fn(() => 'fresh-good')
        const alert = vi.fn()
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            const headers = new Headers(init?.headers)
            const secret = headers.get('X-Hapi-Inline-Secret')
            if (secret === 'stale-wrong') {
                return new Response(JSON.stringify({
                    error: 'operator secret required',
                    code: 'gate_secret_mismatch'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } })
            }
            return new Response(JSON.stringify({ sessions: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })
        expect(await enableOperatorDockFromSettings(prompt, alert, fetchImpl as unknown as typeof fetch)).toBe(true)
        expect(alert).toHaveBeenCalledWith(OPERATOR_DOCK_MISMATCH_ALERT)
        expect(prompt).toHaveBeenCalledOnce()
        expect(localStorage.getItem(OPERATOR_DOCK_SECRET_KEY)).toBe('fresh-good')
    })

    it('refuses enable and does not ask for gate secret when hub JWT is missing', async () => {
        const prompt = vi.fn(() => 'gate-secret')
        const alert = vi.fn()
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            error: 'hub JWT missing or expired (forbidden for gate-secret paste) — re-login to HAPI web',
            code: 'hub_auth_missing'
        }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
        expect(await enableOperatorDockFromSettings(prompt, alert, fetchImpl as unknown as typeof fetch)).toBe(false)
        expect(alert).toHaveBeenCalledWith(OPERATOR_DOCK_HUB_AUTH_ALERT)
        expect(isOperatorDockPrefEnabled()).toBe(false)
    })

    it('probeOperatorDockSecret reads proxy code fields', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            error: 'operator secret required',
            code: 'gate_secret_mismatch'
        }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
        const probe = await probeOperatorDockSecret('x', fetchImpl as unknown as typeof fetch)
        expect(probe.ok).toBe(false)
        expect(probe.kind).toBe('mismatch')
        expect(probe.code).toBe('gate_secret_mismatch')
    })

    it('disable hides the dock but keeps the secret', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }))
        await enableOperatorDockFromSettings(() => 'keep-me', vi.fn(), fetchImpl as unknown as typeof fetch)
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
