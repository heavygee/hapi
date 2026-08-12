/**
 * Operator-gated /hapi proxy for the vendored hapi-inline dock (tag v0.10.2).
 * Hono port of server/node/operator-hapi-proxy.mjs — composed /operator/sessions,
 * messages/upload only, auto-resume on 409 session_inactive. Do not allow-list
 * raw GET /api/sessions.
 */
import { Hono } from 'hono'
import {
    filterOperatorSessions,
    hasConflictingSecretHeaders,
    normalizeFsPath,
    operatorMicSecretMatches,
    parseOperatorMicPath,
    type ParsedOperatorMicPath
} from './allowlist'

export type HapiInlineHostConfig = {
    enabled: boolean
    secret: string
    hubToken: string
    hubBase: string
    hubNamespace: string
    projectPath: string
    machineId: string
    session: string
    appId: string
    build: string
}

export type HapiInlineRouteOptions = {
    config: HapiInlineHostConfig
    fetchImpl?: typeof fetch
}

function noStoreHeaders(): Record<string, string> {
    return { 'Cache-Control': 'private, no-store' }
}

function publicConfigBody(config: HapiInlineHostConfig) {
    const hapiInline = {
        enabled: true,
        appId: config.appId,
        mode: 'proxy' as const,
        hapiProxy: '/hapi',
        session: config.session,
        projectPath: config.projectPath,
        machineId: config.machineId,
        build: config.build,
        sttUrl: null as string | null
    }
    return { hapiInline, operatorMic: hapiInline }
}

function hubPayloadSessionInactive(data: ArrayBuffer | Uint8Array | string): boolean {
    try {
        const text = typeof data === 'string'
            ? data
            : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8')
        const payload = JSON.parse(text || '{}') as { code?: unknown, error?: unknown }
        if (!payload || typeof payload !== 'object') return false
        if (payload.code === 'session_inactive') return true
        const err = String(payload.error || '').toLowerCase()
        return err.includes('session is inactive')
    } catch {
        return false
    }
}

function sessionIdFromAllowedPath(pathname: string): string | null {
    const m = pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/(?:messages|upload)$/)
    return m ? m[1] : null
}

function operatorReady(config: HapiInlineHostConfig): boolean {
    return Boolean(config.enabled && config.secret && config.hubToken)
}

export function createHapiInlineRoutes(options: HapiInlineRouteOptions): Hono {
    const app = new Hono()
    const fetchImpl = options.fetchImpl ?? fetch
    let jwtCache: string | null = null

    const mintJwt = async (config: HapiInlineHostConfig): Promise<string> => {
        const hubBase = config.hubBase.replace(/\/$/, '')
        const r = await fetchImpl(`${hubBase}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: `${config.hubToken}:${config.hubNamespace}` })
        })
        if (!r.ok) throw new Error(`hub-auth-${r.status}`)
        const payload = await r.json() as { token?: string }
        if (!payload.token) throw new Error('hub /api/auth returned no token')
        jwtCache = payload.token
        return payload.token
    }

    const authedFetch = async (
        config: HapiInlineHostConfig,
        url: string,
        init: RequestInit,
        jwt: string
    ): Promise<Response> => {
        let token = jwt
        const headers = new Headers(init.headers)
        headers.set('Authorization', `Bearer ${token}`)
        let hubRes = await fetchImpl(url, { ...init, headers })
        if (hubRes.status === 401) {
            jwtCache = null
            token = await mintJwt(config)
            headers.set('Authorization', `Bearer ${token}`)
            hubRes = await fetchImpl(url, { ...init, headers })
        }
        return hubRes
    }

    app.get('/config', (c) => {
        const config = options.config
        if (!operatorReady(config)) {
            return c.json({ error: 'hapi inline disabled' }, 404)
        }
        c.header('Cache-Control', 'private, no-store')
        return c.json(publicConfigBody(config))
    })

    app.all('/*', async (c) => {
        const config = options.config
        c.header('Cache-Control', 'private, no-store')
        if (!operatorReady(config)) {
            return c.json({ error: 'hapi inline disabled' }, 404)
        }

        const primary = c.req.header('X-Hapi-Inline-Secret')
        const legacy = c.req.header('X-Operator-Mic-Secret')
        if (hasConflictingSecretHeaders(primary, legacy)) {
            return c.json({ error: 'conflicting secret headers' }, 403)
        }
        if (!operatorMicSecretMatches(config.secret, primary, legacy)) {
            return c.json({ error: 'operator secret required' }, 403)
        }

        const rawTarget = c.req.path.replace(/^\/hapi/, '') || '/'
        const target = parseOperatorMicPath(c.req.method, `${rawTarget}${new URL(c.req.url).search}`)
        if (!target) {
            return c.json({ error: 'path not allowed through operator proxy' }, 403)
        }

        try {
            const jwt = jwtCache || (await mintJwt(config))
            if (target.kind === 'operator-sessions') {
                return await handleComposed(c, config, jwt, target)
            }
            return await handleSessionAction(c, config, jwt, target)
        } catch {
            return c.json({ error: 'upstream unavailable' }, 502)
        }
    })

    async function handleComposed(
        c: { req: { method: string, json: () => Promise<unknown> } },
        config: HapiInlineHostConfig,
        jwt: string,
        _target: ParsedOperatorMicPath
    ) {
        const hubBase = config.hubBase.replace(/\/$/, '')
        if (c.req.method === 'GET') {
            if (!config.projectPath) {
                return new Response(JSON.stringify({ error: 'project path not configured' }), {
                    status: 503,
                    headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
                })
            }
            const hubRes = await authedFetch(config, `${hubBase}/api/sessions`, { headers: {} }, jwt)
            if (!hubRes.ok) {
                return new Response(hubRes.body, {
                    status: hubRes.status,
                    headers: {
                        ...noStoreHeaders(),
                        'Content-Type': hubRes.headers.get('content-type') || 'application/json'
                    }
                })
            }
            const payload = await hubRes.json() as { sessions?: unknown[] } | unknown[]
            const raw = (Array.isArray(payload)
                ? payload
                : (payload && typeof payload === 'object' && Array.isArray(payload.sessions) ? payload.sessions : [])) as Parameters<typeof filterOperatorSessions>[0]
            return new Response(JSON.stringify({ sessions: filterOperatorSessions(raw, config.projectPath) }), {
                status: 200,
                headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
            })
        }

        if (!config.machineId || !config.projectPath) {
            return new Response(JSON.stringify({ error: 'operator spawn not configured' }), {
                status: 503,
                headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
            })
        }
        const directory = normalizeFsPath(config.projectPath)
        let name = ''
        try {
            const parsed = await c.req.json()
            if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof parsed.name === 'string') {
                name = parsed.name.trim().slice(0, 255)
            }
        } catch {
            // directory still comes from the server
        }
        const spawnRes = await authedFetch(
            config,
            `${hubBase}/api/machines/${encodeURIComponent(config.machineId)}/spawn`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory })
            },
            jwt
        )
        if (!spawnRes.ok) {
            return new Response(spawnRes.body, {
                status: spawnRes.status,
                headers: {
                    ...noStoreHeaders(),
                    'Content-Type': spawnRes.headers.get('content-type') || 'application/json'
                }
            })
        }
        const result = await spawnRes.json() as { type?: string, sessionId?: string, message?: string }
        if (!result || result.type !== 'success' || typeof result.sessionId !== 'string') {
            return new Response(JSON.stringify({ error: result?.message || 'spawn failed' }), {
                status: 502,
                headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
            })
        }
        if (name) {
            try {
                await authedFetch(
                    config,
                    `${hubBase}/api/sessions/${encodeURIComponent(result.sessionId)}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    },
                    jwt
                )
            } catch {
                // rename is best-effort
            }
        }
        return new Response(JSON.stringify({ id: result.sessionId }), {
            status: 200,
            headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
        })
    }

    async function handleSessionAction(
        c: { req: { method: string, arrayBuffer: () => Promise<ArrayBuffer>, header: (n: string) => string | undefined } },
        config: HapiInlineHostConfig,
        jwt: string,
        target: Extract<ParsedOperatorMicPath, { kind: 'session-action' }>
    ) {
        const hubBase = config.hubBase.replace(/\/$/, '')
        const upstream = new URL(target.pathname, `${hubBase}/`)
        if (target.search) upstream.search = target.search.replace(/^\?/, '')
        if (upstream.pathname !== target.pathname) {
            return new Response(JSON.stringify({ error: 'path canonicalization mismatch' }), {
                status: 403,
                headers: { ...noStoreHeaders(), 'Content-Type': 'application/json' }
            })
        }

        const method = target.method
        const body = method === 'GET' ? undefined : await c.req.arrayBuffer()
        let jwtRetried = false
        let inactiveRetried = false
        let token = jwt
        while (true) {
            const hubRes = await fetchImpl(upstream.toString(), {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': c.req.header('content-type') || 'application/json'
                },
                body
            })
            const buf = await hubRes.arrayBuffer()
            if (hubRes.status === 401 && !jwtRetried) {
                jwtCache = null
                token = await mintJwt(config)
                jwtRetried = true
                continue
            }
            if (hubRes.status === 409 && hubPayloadSessionInactive(buf) && !inactiveRetried) {
                const sid = sessionIdFromAllowedPath(target.pathname)
                inactiveRetried = true
                if (sid) {
                    const resume = await fetchImpl(
                        `${hubBase}/api/sessions/${encodeURIComponent(sid)}/resume`,
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: '{}'
                        }
                    )
                    if (resume.ok) continue
                }
            }
            return new Response(buf, {
                status: hubRes.status,
                headers: {
                    ...noStoreHeaders(),
                    'Content-Type': hubRes.headers.get('content-type') || 'application/json'
                }
            })
        }
    }

    return app
}
