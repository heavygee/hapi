/**
 * Host visibility for the vendored hapi-inline dock.
 * Keep in sync with web/public/operator-dock/hapi-boot.js.
 * Do not edit vendored operator-dock.js — secret key is the dock's storage name.
 */

export const OPERATOR_DOCK_PREF_KEY = 'hapi-operator-dock'
/** Vendored dock reads this key (`SECRET_KEY` in operator-dock.js). */
export const OPERATOR_DOCK_SECRET_KEY = 'hapiInlineSecret'

/** Gate secret ≠ HAPI web login token / CLI_API_TOKEN / JWT. */
export const OPERATOR_DOCK_PROMPT =
    'Paste the operator GATE secret (hub HAPI_INLINE_SECRET). Not the HAPI login / CLI token / JWT:'

export const OPERATOR_DOCK_MISMATCH_ALERT =
    'That gate secret does not match the hub. Re-paste HAPI_INLINE_SECRET from hub.env — not the web login token.'

export const OPERATOR_DOCK_HUB_AUTH_ALERT =
    'HAPI web login/JWT is missing or expired (not the gate secret). Sign in to HAPI again, then re-enable operator tools.'

export const OPERATOR_DOCK_GENERIC_ALERT =
    'Could not verify the operator gate secret with /hapi/operator/sessions. Try again after confirming hub is up.'

const UNLOCK_PATHS = new Set(['/opmic', '/mic', '/unlock'])
const PROBE_PATH = '/hapi/operator/sessions'

export type OperatorDockProbeKind =
    | 'ok'
    | 'mismatch'
    | 'conflict'
    | 'hub_auth'
    | 'forbidden'
    | 'unknown'

export type OperatorDockProbeResult = {
    ok: boolean
    status: number
    kind: OperatorDockProbeKind
    error: string
    code: string
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function normalizePathname(pathname: string): string {
    const raw = String(pathname || '/').trim() || '/'
    if (raw === '/') return '/'
    return raw.replace(/\/+$/, '') || '/'
}

export function isOperatorDockKnock(pathname: string, search = ''): boolean {
    if (UNLOCK_PATHS.has(normalizePathname(pathname))) return true
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
    return params.has('opmic')
}

export function isOperatorDockPrefEnabled(): boolean {
    return safeGetItem(OPERATOR_DOCK_PREF_KEY) === 'true'
}

export function shouldBootOperatorDock(pathname: string, search = ''): boolean {
    return isOperatorDockPrefEnabled() || isOperatorDockKnock(pathname, search)
}

export function applyOperatorDockVisibility(visible: boolean): void {
    if (!isBrowser()) return
    document.documentElement.setAttribute('data-hapi-operator-dock', visible ? 'on' : 'off')
}

export function persistOperatorDockKnock(pathname: string, search = ''): void {
    if (!isOperatorDockKnock(pathname, search)) return
    safeSetItem(OPERATOR_DOCK_PREF_KEY, 'true')
    applyOperatorDockVisibility(true)
}

/** Classify /hapi proxy rejects so Settings never tells the operator to paste gate secret for JWT misses. */
export function classifyOperatorDockProbe(status: number, error: string, code = ''): OperatorDockProbeKind {
    const e = String(error || '').toLowerCase()
    const c = String(code || '').toLowerCase()
    if (status >= 200 && status < 300) return 'ok'
    if (c === 'gate_secret_mismatch' || e.includes('operator secret required') || e.includes('secret required')) {
        return 'mismatch'
    }
    if (c === 'gate_secret_conflict' || e.includes('conflict')) return 'conflict'
    if (
        c === 'hub_auth_missing'
        || e.includes('missing authorization token')
        || e.includes('hub jwt')
        || e.includes('hub authorization')
        || e.includes('re-login to hapi')
    ) {
        return 'hub_auth'
    }
    if (c === 'proxy_path_forbidden' || e.includes('not allowed') || e.includes('forbidden')) return 'forbidden'
    return 'unknown'
}

export async function probeOperatorDockSecret(
    secret: string,
    fetchImpl: typeof fetch = fetch
): Promise<OperatorDockProbeResult> {
    const trimmed = String(secret || '').trim()
    if (!trimmed) {
        return { ok: false, status: 0, kind: 'mismatch', error: 'empty secret', code: 'gate_secret_mismatch' }
    }
    try {
        const res = await fetchImpl(PROBE_PATH, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Hapi-Inline-Secret': trimmed,
                'X-Operator-Mic-Secret': trimmed
            },
            cache: 'no-store'
        })
        let error = ''
        let code = ''
        const text = await res.text()
        if (text) {
            try {
                const body = JSON.parse(text) as { error?: unknown, code?: unknown }
                error = typeof body.error === 'string' ? body.error : ''
                code = typeof body.code === 'string' ? body.code : ''
            } catch {
                error = text.trim()
            }
        }
        const kind = classifyOperatorDockProbe(res.status, error, code)
        return { ok: res.ok, status: res.status, kind: res.ok ? 'ok' : kind, error, code }
    } catch {
        return { ok: false, status: 0, kind: 'unknown', error: 'network', code: '' }
    }
}

function alertOperator(message: string, alertFn: (message: string) => void): void {
    try {
        alertFn(message)
    } catch {
        // Ignore alert failures (headless)
    }
}

/**
 * Settings unlock with an explicit secret (no window.prompt — Quest native dialogs mangle paste).
 */
export async function enableOperatorDockWithSecret(
    secret: string,
    fetchImpl: typeof fetch = fetch
): Promise<{ ok: true } | { ok: false, kind: OperatorDockProbeKind, message: string }> {
    const trimmed = String(secret || '').trim()
    if (!trimmed) {
        return { ok: false, kind: 'mismatch', message: OPERATOR_DOCK_PROMPT }
    }
    const probe = await probeOperatorDockSecret(trimmed, fetchImpl)
    if (probe.ok) {
        safeSetItem(OPERATOR_DOCK_SECRET_KEY, trimmed)
        safeSetItem(OPERATOR_DOCK_PREF_KEY, 'true')
        applyOperatorDockVisibility(true)
        const host = (window as Window & { HapiInlineHost?: { boot?: () => void } }).HapiInlineHost
        host?.boot?.()
        return { ok: true }
    }
    if (probe.kind === 'mismatch' || probe.kind === 'conflict') {
        safeRemoveItem(OPERATOR_DOCK_SECRET_KEY)
        return { ok: false, kind: probe.kind, message: OPERATOR_DOCK_MISMATCH_ALERT }
    }
    if (probe.kind === 'hub_auth') {
        return { ok: false, kind: 'hub_auth', message: OPERATOR_DOCK_HUB_AUTH_ALERT }
    }
    return { ok: false, kind: probe.kind, message: OPERATOR_DOCK_GENERIC_ALERT }
}

/**
 * Settings unlock: always probe the gate secret (including a previously stored one).
 * Stale wrong secrets must not silently show H/markup (Quest dogfood).
 * Prefer enableOperatorDockWithSecret + in-page Settings UI on Quest (no window.prompt).
 */
export async function enableOperatorDockFromSettings(
    promptFn: (message: string) => string | null = (message) => window.prompt(message),
    alertFn: (message: string) => void = (message) => window.alert(message),
    fetchImpl: typeof fetch = fetch
): Promise<boolean> {
    let secret = (safeGetItem(OPERATOR_DOCK_SECRET_KEY) || '').trim()
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!secret) {
            const entered = promptFn(OPERATOR_DOCK_PROMPT)
            if (!entered || !entered.trim()) return false
            secret = entered.trim()
        }

        const result = await enableOperatorDockWithSecret(secret, fetchImpl)
        if (result.ok) return true

        if (result.kind === 'mismatch' || result.kind === 'conflict') {
            secret = ''
            alertOperator(result.message, alertFn)
            continue
        }

        alertOperator(result.message, alertFn)
        return false
    }
    return false
}

export function disableOperatorDockFromSettings(): void {
    safeRemoveItem(OPERATOR_DOCK_PREF_KEY)
    applyOperatorDockVisibility(false)
}
