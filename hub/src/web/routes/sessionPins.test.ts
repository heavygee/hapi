import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createSessionPinsRoutes } from './sessionPins'
import type { WebAppEnv } from '../middleware/auth'

function makeApp(engine: SyncEngine): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionPinsRoutes(() => engine))
    return app
}

describe('sessionPins routes', () => {
    it('pins and unpins a message as operator_pin events', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('pin-sess', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
        const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)
        const app = makeApp(engine)

        const pinRes = await app.request(`/api/sessions/${session.id}/pins`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messageId: 'hub-msg-1',
                summary: 'Pinned summary with https://example.com/x',
                targetMessageId: 'agent-text:hub-msg-1:0'
            })
        })
        expect(pinRes.status).toBe(201)
        const pinBody = await pinRes.json() as { event: { eventType: string; summary: string; payloadJson: string } }
        expect(pinBody.event.eventType).toBe('operator_pin')
        expect(pinBody.event.summary).toContain('Pinned summary')
        expect(JSON.parse(pinBody.event.payloadJson).messageId).toBe('hub-msg-1')

        const listed = engine.getSystemEvents({ sessionId: session.id, eventType: 'operator_pin', limit: 10 })
        expect(listed).toHaveLength(1)

        const again = await app.request(`/api/sessions/${session.id}/pins`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messageId: 'hub-msg-1',
                summary: 'Pinned summary with https://example.com/x'
            })
        })
        expect(again.status).toBe(201)
        expect(engine.getSystemEvents({ sessionId: session.id, eventType: 'operator_pin', limit: 10 })).toHaveLength(1)

        const del = await app.request(`/api/sessions/${session.id}/pins/${encodeURIComponent('hub-msg-1')}`, {
            method: 'DELETE'
        })
        expect(del.status).toBe(200)
        expect(engine.getSystemEvents({ sessionId: session.id, eventType: 'operator_pin', limit: 10 })).toHaveLength(0)
    })
})
