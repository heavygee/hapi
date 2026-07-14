import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createSystemEventsRoutes } from './systemEvents'
import type { WebAppEnv } from '../middleware/auth'

describe('systemEvents routes', () => {
    it('lists persisted events', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('evt-test', { flavor: 'codex', path: '/tmp' }, null, 'default')
        store.events.insert({
            ts: Date.now(),
            sourceKind: 'worker',
            sourceRef: 'peer',
            eventType: 'completed',
            attentionCandidate: 1,
            summary: 'Route smoke event',
            relatedSessionId: session.id,
            provenance: 'test'
        })

        const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
        const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSystemEventsRoutes(() => engine))

        const res = await app.request('/api/system-events?limit=5')
        expect(res.status).toBe(200)
        const body = await res.json() as { total: number; events: Array<{ summary: string }> }
        expect(body.total).toBe(1)
        expect(body.events[0]?.summary).toBe('Route smoke event')
    })

    it('filters by related_session_id via sessionId query', async () => {
        const store = new Store(':memory:')
        const a = store.sessions.getOrCreateSession('sess-a', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const b = store.sessions.getOrCreateSession('sess-b', { flavor: 'codex', path: '/tmp' }, null, 'default')
        store.events.insert({
            ts: Date.now(),
            sourceKind: 'system',
            eventType: 'link_seen',
            attentionCandidate: 0,
            summary: 'Link seen: example.com/a',
            relatedSessionId: a.id,
            provenance: 'test'
        })
        store.events.insert({
            ts: Date.now(),
            sourceKind: 'system',
            eventType: 'link_seen',
            attentionCandidate: 0,
            summary: 'Link seen: example.com/b',
            relatedSessionId: b.id,
            provenance: 'test'
        })

        const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
        const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSystemEventsRoutes(() => engine))

        const res = await app.request(`/api/system-events?sessionId=${encodeURIComponent(a.id)}&eventType=link_seen`)
        expect(res.status).toBe(200)
        const body = await res.json() as { events: Array<{ relatedSessionId: string | null; summary: string }> }
        expect(body.events).toHaveLength(1)
        expect(body.events[0]?.relatedSessionId).toBe(a.id)
        expect(body.events[0]?.summary).toContain('example.com/a')
    })
})
