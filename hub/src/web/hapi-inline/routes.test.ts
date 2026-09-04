import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { loadHapiInlineConfig } from './config'
import { createHapiInlineRoutes, type HapiInlineHostConfig } from './routes'

const PROJECT = '/home/heavygee/coding/hapi'
const SECRET = 'test-operator-secret'
const MACHINE = '5f5a87e8-25b2-4732-ba4c-aba95f695bd7'

function enabledConfig(overrides: Partial<HapiInlineHostConfig> = {}): HapiInlineHostConfig {
    return {
        enabled: true,
        secret: SECRET,
        hubToken: 'cli-token',
        hubBase: 'http://127.0.0.1:3006',
        hubNamespace: 'default',
        projectPath: PROJECT,
        machineId: MACHINE,
        session: '217719f7-479c-4250-99a6-ee15cbc1c6cc',
        appId: 'hapi-web',
        build: 'v0.11.6',
        spawnAgent: 'cursor',
        spawnYolo: true,
        ...overrides
    }
}

function mount(config: HapiInlineHostConfig, fetchImpl: typeof fetch) {
    const app = new Hono()
    app.route('/hapi', createHapiInlineRoutes({ config, fetchImpl }))
    return app
}

const secretHeaders = {
    'X-Hapi-Inline-Secret': SECRET,
    'X-Operator-Mic-Secret': SECRET
}

describe('hapi-inline host routes', () => {
    it('stamps public config.build from the vendored pin (mic payload)', () => {
        expect(loadHapiInlineConfig().build).toBe('v0.12.8')
    })

    it('returns public config without a secret and never includes the secret', async () => {
        const app = mount(enabledConfig(), fetch)
        const res = await app.request('/hapi/config')
        expect(res.status).toBe(200)
        const body = await res.json() as { hapiInline: Record<string, unknown> }
        expect(body.hapiInline.enabled).toBe(true)
        expect(body.hapiInline.mode).toBe('proxy')
        expect(body.hapiInline.hapiProxy).toBe('/hapi')
        expect(body.hapiInline.projectPath).toBe(PROJECT)
        expect(body.hapiInline.machineId).toBe(MACHINE)
        expect(body.hapiInline.spawnAgent).toBe('cursor')
        expect(body.hapiInline.spawnYolo).toBe(true)
        expect(body.hapiInline.sttUrl).toBe('/api/stt')
        expect(body.hapiInline.sttAuth).toBe('hub-jwt')
        expect(JSON.stringify(body)).not.toContain(SECRET)
    })

    it('exposes overridden spawnAgent/spawnYolo on public config', async () => {
        const app = mount(enabledConfig({ spawnAgent: 'claude', spawnYolo: false }), fetch)
        const body = await (await app.request('/hapi/config')).json() as { hapiInline: Record<string, unknown> }
        expect(body.hapiInline.spawnAgent).toBe('claude')
        expect(body.hapiInline.spawnYolo).toBe(false)
    })

    it('falls unknown spawnAgent back to cursor on public config', async () => {
        const app = mount(enabledConfig({ spawnAgent: 'not-real' }), fetch)
        const body = await (await app.request('/hapi/config')).json() as { hapiInline: Record<string, unknown> }
        expect(body.hapiInline.spawnAgent).toBe('cursor')
    })

    it('404s config and proxy when disabled', async () => {
        const app = mount(enabledConfig({ enabled: false }), fetch)
        expect((await app.request('/hapi/config')).status).toBe(404)
        expect((await app.request('/hapi/operator/sessions', { headers: secretHeaders })).status).toBe(404)
    })

    it('rejects missing or conflicting operator secrets', async () => {
        const app = mount(enabledConfig(), fetch)
        const missing = await app.request('/hapi/operator/sessions')
        expect(missing.status).toBe(403)
        expect(await missing.json()).toEqual({
            error: 'operator secret required',
            code: 'gate_secret_mismatch'
        })
        const conflict = await app.request('/hapi/operator/sessions', {
            headers: { 'X-Hapi-Inline-Secret': 'a', 'X-Operator-Mic-Secret': 'b' }
        })
        expect(conflict.status).toBe(403)
        expect(await conflict.json()).toEqual({
            error: 'conflicting secret headers',
            code: 'gate_secret_conflict'
        })
    })

    it('does not allow-list raw GET /api/sessions', async () => {
        const app = mount(enabledConfig(), fetch)
        const res = await app.request('/hapi/api/sessions', { headers: secretHeaders })
        expect(res.status).toBe(403)
        const body = await res.json() as { error: string, code: string }
        expect(body.error).toContain('not allowed')
        expect(body.code).toBe('proxy_path_forbidden')
    })

    it('rewrites upstream Missing authorization token so dock copy does not blame the gate secret', async () => {
        const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.includes('/api/sessions') && !url.includes('/messages')) {
                return new Response('Missing authorization token', { status: 401 })
            }
            return new Response('unexpected', { status: 500 })
        }) as typeof fetch
        const app = mount(enabledConfig(), fetchImpl)
        const res = await app.request('/hapi/operator/sessions', { headers: secretHeaders })
        expect(res.status).toBe(401)
        const body = await res.json() as { error: string, code: string }
        expect(body.code).toBe('hub_auth_missing')
        expect(body.error.toLowerCase()).toContain('missing authorization token')
        expect(body.error.toLowerCase()).toContain('not the operator gate secret')
        expect(body.error).not.toMatch(/operator secret required/i)
    })

    it('GET /operator/sessions filters to the HAPI checkout', async () => {
        const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.includes('/api/sessions') && !url.includes('/messages')) {
                return new Response(JSON.stringify({
                    sessions: [
                        {
                            id: 'keep',
                            active: true,
                            updatedAt: 1,
                            pendingRequestsCount: 0,
                            metadata: { name: 'HAPI peer', path: PROJECT }
                        },
                        {
                            id: 'drop',
                            active: true,
                            updatedAt: 2,
                            pendingRequestsCount: 0,
                            metadata: { name: 'Newman', path: '/home/heavygee/coding/newman.rip' }
                        }
                    ]
                }), { status: 200 })
            }
            return new Response('no', { status: 500 })
        }) as typeof fetch
        const app = mount(enabledConfig(), fetchImpl)
        const res = await app.request('/hapi/operator/sessions', { headers: secretHeaders })
        expect(res.status).toBe(200)
        const body = await res.json() as { sessions: Array<{ id: string }> }
        expect(body.sessions.map((s) => s.id)).toEqual(['keep'])
    })

    it('POST /operator/sessions spawns with server directory, ignoring body.directory', async () => {
        const seen: string[] = []
        const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.includes('/spawn')) {
                seen.push(String(init?.body))
                return new Response(JSON.stringify({ type: 'success', sessionId: 'new-sess' }), { status: 200 })
            }
            return new Response('no', { status: 500 })
        }) as typeof fetch
        const app = mount(enabledConfig(), fetchImpl)
        const res = await app.request('/hapi/operator/sessions', {
            method: 'POST',
            headers: { ...secretHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ directory: '/tmp/evil', name: 'from-dock' })
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ id: 'new-sess' })
        expect(seen).toHaveLength(1)
        expect(seen[0]).toContain(PROJECT)
        expect(seen[0]).not.toContain('/tmp/evil')
    })

    it('POST /operator/sessions uses server agent+yolo and ignores client privilege fields', async () => {
        const seen: unknown[] = []
        const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.includes('/spawn')) {
                seen.push(JSON.parse(String(init?.body)))
                return new Response(JSON.stringify({ type: 'success', sessionId: 'new-sess' }), { status: 200 })
            }
            return new Response('no', { status: 500 })
        }) as typeof fetch
        const app = mount(enabledConfig(), fetchImpl)
        const res = await app.request('/hapi/operator/sessions', {
            method: 'POST',
            headers: { ...secretHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({
                directory: '/tmp/evil',
                agent: 'claude',
                yolo: false,
                name: 'from-dock'
            })
        })
        expect(res.status).toBe(200)
        expect(seen).toEqual([{ directory: PROJECT, agent: 'cursor', model: 'auto', yolo: true }])
    })

    it('POST /operator/sessions omits yolo when server spawnYolo is false', async () => {
        const seen: unknown[] = []
        const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.includes('/spawn')) {
                seen.push(JSON.parse(String(init?.body)))
                return new Response(JSON.stringify({ type: 'success', sessionId: 'new-sess' }), { status: 200 })
            }
            return new Response('no', { status: 500 })
        }) as typeof fetch
        const app = mount(enabledConfig({ spawnAgent: 'claude', spawnYolo: false }), fetchImpl)
        const res = await app.request('/hapi/operator/sessions', {
            method: 'POST',
            headers: { ...secretHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'cursor', yolo: true })
        })
        expect(res.status).toBe(200)
        expect(seen).toEqual([{ directory: PROJECT, agent: 'claude' }])
    })

    it('does not proxy STT through the gate-secret /hapi allow-list', async () => {
        const app = mount(enabledConfig(), fetch)
        const res = await app.request('/hapi/api/stt', {
            method: 'POST',
            headers: { ...secretHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ audio_b64: 'YQ==', mime: 'audio/webm' })
        })
        expect(res.status).toBe(403)
        const body = await res.json() as { code: string }
        expect(body.code).toBe('proxy_path_forbidden')
    })
})
