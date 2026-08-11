/**
 * Host visibility for the vendored hapi-inline dock.
 * Keep in sync with web/public/operator-dock/hapi-boot.js.
 * Do not edit vendored operator-dock.js — secret key is the dock's storage name.
 */

export const OPERATOR_DOCK_PREF_KEY = 'hapi-operator-dock'
/** Vendored dock reads this key (`SECRET_KEY` in operator-dock.js). */
export const OPERATOR_DOCK_SECRET_KEY = 'hapiInlineSecret'
export const OPERATOR_DOCK_PROMPT =
    'HAPI inline is locked. Paste the operator gate secret (stored on this device only):'

const UNLOCK_PATHS = new Set(['/opmic', '/mic', '/unlock'])

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

export function enableOperatorDockFromSettings(
    promptFn: (message: string) => string | null = (message) => window.prompt(message)
): boolean {
    const existing = (safeGetItem(OPERATOR_DOCK_SECRET_KEY) || '').trim()
    if (!existing) {
        const entered = promptFn(OPERATOR_DOCK_PROMPT)
        if (!entered || !entered.trim()) return false
        safeSetItem(OPERATOR_DOCK_SECRET_KEY, entered.trim())
    }
    safeSetItem(OPERATOR_DOCK_PREF_KEY, 'true')
    applyOperatorDockVisibility(true)
    const host = (window as Window & { HapiInlineHost?: { boot?: () => void } }).HapiInlineHost
    host?.boot?.()
    return true
}

export function disableOperatorDockFromSettings(): void {
    safeRemoveItem(OPERATOR_DOCK_PREF_KEY)
    applyOperatorDockVisibility(false)
}
