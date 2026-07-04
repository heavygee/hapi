import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { buildOverseerSessionIdentity, mergeEventPayloadWithSession } from '@hapi/protocol'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createInboxItemsRoutes } from './inboxItems'
import type { WebAppEnv } from '../middleware/auth'

describe('inboxItems routes', () => {
    it('lists promoted inbox items in coarse-rank order', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('route-inbox', { name: 'route-session' }, null, 'default')
        const payloadJson = mergeEventPayloadWithSession({}, buildOverseerSessionIdentity({
            id: session.id,
            flavor: 'codex',
            tag: session.tag,
            metadata: session.metadata as { name?: string } | null
        }))
        const event = store.events.insert({
            ts: Date.now(),
            sourceKind: 'worker',
            sourceRef: 'peer',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'Route smoke inbox item',
            relatedSessionId: session.id,
            payloadJson,
            provenance: 'test'
        })
        store.inbox.promoteAttentionEvent(event!)

        const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
        const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createInboxItemsRoutes(() => engine))

        const listRes = await app.request('/api/inbox-items?activeOnly=1')
        expect(listRes.status).toBe(200)
        const body = await listRes.json() as { total: number; items: Array<{ summary: string; title: string }> }
        expect(body.total).toBe(1)
        expect(body.items[0]?.summary).toBe('Route smoke inbox item')
        expect(body.items[0]?.title).toBe('route-session')
    })

    it('records operator actions', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('route-action', { name: 'x' }, null, 'default')
        const payloadJson = mergeEventPayloadWithSession({}, buildOverseerSessionIdentity({
            id: session.id,
            flavor: 'codex',
            tag: session.tag,
            metadata: session.metadata as { name?: string } | null
        }))
        const event = store.events.insert({
            ts: Date.now(),
            sourceKind: 'worker',
            eventType: 'needs_decision',
            attentionCandidate: 1,
            summary: 'decide',
            relatedSessionId: session.id,
            payloadJson,
            provenance: 'test'
        })
        const item = store.inbox.promoteAttentionEvent(event!)

        const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
        const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createInboxItemsRoutes(() => engine))

        const res = await app.request(`/api/inbox-items/${item!.id}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'dismiss', feedback: 'noise' })
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { item: { status: string; operatorFeedback: string | null } }
        expect(body.item.status).toBe('obsoleted')
        expect(body.item.operatorFeedback).toBe('noise')
    })
})
