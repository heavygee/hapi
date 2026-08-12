import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
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
        build: 'v0.10.3',
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
        expect(JSON.stringify(body)).not.toContain(SECRET)
    })

    it('404s config and proxy when disabled', async () => {
        const app = mount(enabledConfig({ enabled: false }), fetch)
        expect((await app.request('/hapi/config')).status).toBe(404)
        expect((await app.request('/hapi/operator/sessions', { headers: secretHeaders })).status).toBe(404)
    })

    it('rejects missing or conflicting operator secrets', async () => {
        const app = mount(enabledConfig(), fetch)
        expect((await app.request('/hapi/operator/sessions')).status).toBe(403)
        expect((await app.request('/hapi/operator/sessions', {
            headers: { 'X-Hapi-Inline-Secret': 'a', 'X-Operator-Mic-Secret': 'b' }
        })).status).toBe(403)
    })

    it('does not allow-list raw GET /api/sessions', async () => {
        const app = mount(enabledConfig(), fetch)
        const res = await app.request('/hapi/api/sessions', { headers: secretHeaders })
        expect(res.status).toBe(403)
        const body = await res.json() as { error: string }
        expect(body.error).toContain('not allowed')
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
})
