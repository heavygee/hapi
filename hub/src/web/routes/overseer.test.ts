import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createOverseerRoutes } from './overseer'
import type { WebAppEnv } from '../middleware/auth'

function buildApp(store: Store): Hono<WebAppEnv> {
    const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
    const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createOverseerRoutes(() => engine))
    return app
}

describe('overseer routes', () => {
    it('GET /overseer/identity returns read-only identity + system prompt', async () => {
        const app = buildApp(new Store(':memory:'))
        const res = await app.request('/api/overseer/identity')
        expect(res.status).toBe(200)
        const body = await res.json() as {
            identity: { canDispatch: boolean; tools: unknown[] }
            systemPrompt: string
        }
        expect(body.identity.canDispatch).toBe(false)
        expect(body.identity.tools.length).toBe(11)
        expect(body.systemPrompt).toContain('Overseer')
    })

    it('POST /overseer/tools/record_disposition is gated off on the read-only HTTP surface (403)', async () => {
        const store = new Store(':memory:')
        const app = buildApp(store)
        const res = await app.request('/api/overseer/tools/record_disposition', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ itemId: 1, action: 'done' })
        })
        expect(res.status).toBe(403)
    })

    it('GET /overseer/voice returns prompt + backend descriptor', async () => {
        const app = buildApp(new Store(':memory:'))
        const res = await app.request('/api/overseer/voice')
        expect(res.status).toBe(200)
        const body = await res.json() as { systemPrompt: string; backends: unknown }
        expect(body.systemPrompt).toContain('Overseer')
        expect(Array.isArray(body.backends)).toBe(true)
    })

    it('POST /overseer/tools/query_events dispatches a read-only tool', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('r', { flavor: 'codex', path: '/tmp/web' }, null, 'default')
        store.events.insert({
            ts: Date.now(), sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, severity: 4,
            summary: 'blocked event', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'web' } })
        })
        const app = buildApp(store)

        const res = await app.request('/api/overseer/tools/query_events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ severityMin: 4 })
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { tool: string; result: { events: Array<{ summary: string }> } }
        expect(body.tool).toBe('query_events')
        expect(body.result.events[0]?.summary).toBe('blocked event')
    })

    it('POST /overseer/tools rejects unknown tool (404) and bad args (400)', async () => {
        const app = buildApp(new Store(':memory:'))

        const unknown = await app.request('/api/overseer/tools/dispatch_now', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        })
        expect(unknown.status).toBe(404)

        const bad = await app.request('/api/overseer/tools/explain_priority', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: -1 })
        })
        expect(bad.status).toBe(400)
    })

    it('POST /overseer/convo-turns persists a convo_turn event', async () => {
        const store = new Store(':memory:')
        const app = buildApp(store)
        const res = await app.request('/api/overseer/convo-turns', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operatorText: 'who is blocked?', overseerText: 'peer-15 on CI auth' })
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { event: { eventType: string; attentionCandidate: number } }
        expect(body.event.eventType).toBe('convo_turn')
        expect(body.event.attentionCandidate).toBe(0)
    })

    it('POST /overseer/convo-turns rejects an empty turn', async () => {
        const app = buildApp(new Store(':memory:'))
        const res = await app.request('/api/overseer/convo-turns', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operatorText: '   ', overseerText: '' })
        })
        expect(res.status).toBe(400)
    })
})
