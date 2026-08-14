/**
 * Host wrapper: vendored dock POSTs /api/stt with gate-secret headers.
 * Dictate / hub /api/stt is executive — HAPI web JWT, not HAPI_INLINE_SECRET.
 * Do not lasting-edit operator-dock.js for this.
 */

const TEXT_ONLY =
    'Sign in to HAPI for voice. The gate secret unlocks the dock; STT uses your HAPI login.'

export function isHubSttUrl(url: string): boolean {
    try {
        const parsed = url.startsWith('http://') || url.startsWith('https://')
            ? new URL(url)
            : new URL(url, 'http://hapi.invalid')
        return parsed.pathname === '/api/stt'
    } catch {
        return false
    }
}

export async function wrapOperatorDockSttRequest(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    getJwt: () => string | null | undefined,
    fetchImpl: typeof fetch
): Promise<Response> {
    const url = typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.href
            : input.url
    if (!isHubSttUrl(url)) {
        return fetchImpl(input, init)
    }
    const jwt = String(getJwt() || '').trim()
    if (!jwt) {
        return new Response(JSON.stringify({ ok: false, error: TEXT_ONLY }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    }
    const headers = new Headers(init?.headers)
    if (input instanceof Request) {
        input.headers.forEach((value, key) => {
            if (!headers.has(key)) headers.set(key, value)
        })
    }
    headers.delete('X-Hapi-Inline-Secret')
    headers.delete('X-Operator-Mic-Secret')
    headers.set('Authorization', `Bearer ${jwt}`)
    return fetchImpl(input, { ...init, headers })
}

export function installOperatorDockSttJwtFetch(getJwt: () => string | null | undefined): () => void {
    if (typeof window === 'undefined') return () => undefined
    const orig = window.fetch.bind(window)
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        wrapOperatorDockSttRequest(input, init, getJwt, orig)) as typeof fetch
    return () => {
        window.fetch = orig
    }
}
