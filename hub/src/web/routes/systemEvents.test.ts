import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createSystemEventsRoutes } from './systemEvents'

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

        const app = new Hono()
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
})
