import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createSystemEventsRoutes } from './systemEvents'
import type { WebAppEnv } from '../middleware/auth'

function createApp(engine: SyncEngine, namespace = 'default') {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createSystemEventsRoutes(() => engine))
    return app
}

function createEngine(store: Store): SyncEngine {
    const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
    return new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)
}

function validChannelBody(overrides: Record<string, unknown> = {}) {
    return {
        sourceKind: 'channel',
        sourceRef: 'contrib-state:tiann/hapi',
        eventType: 'blocked',
        attentionCandidate: 1,
        operatorActionRequired: 1,
        summary: 'CI failed on upstream PR',
        artifactRefs: [{
            kind: 'github_pr',
            url: 'https://github.com/tiann/hapi/pull/999',
            repo: 'tiann/hapi',
            number: 999,
            target_id: 'upstream',
            control: 'theirs',
            github_state: 'open',
            source: 'external'
        }],
        payload: { disposition: 'CHANGES_REQUESTED' },
        tags: ['contrib-state'],
        dedupeKey: 'contrib:tiann/hapi#999:blocked',
        idempotencyKey: 'contrib:tiann/hapi#999:fp-test-1',
        provenance: 'contrib-state@meta-daily',
        severity: 3,
        ...overrides
    }
}

async function postEvent(app: Hono<WebAppEnv>, body: unknown) {
    return app.request('/api/system-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
}

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

        const app = createApp(createEngine(store))

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

        const app = createApp(createEngine(store))

        const res = await app.request(`/api/system-events?sessionId=${encodeURIComponent(a.id)}&eventType=link_seen`)
        expect(res.status).toBe(200)
        const body = await res.json() as { events: Array<{ relatedSessionId: string | null; summary: string }> }
        expect(body.events).toHaveLength(1)
        expect(body.events[0]?.relatedSessionId).toBe(a.id)
        expect(body.events[0]?.summary).toContain('example.com/a')
    })

    it('rejects POST with sourceKind worker', async () => {
        const store = new Store(':memory:')
        const app = createApp(createEngine(store))

        const res = await postEvent(app, validChannelBody({ sourceKind: 'worker' }))
        expect(res.status).toBe(400)
    })

    it('accepts valid channel event and lists it via sourceKind filter', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('chan-sess', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))

        const res = await postEvent(app, validChannelBody({ relatedSessionId: session.id }))
        expect(res.status).toBe(201)
        const created = await res.json() as { event: { sourceKind: string; relatedSessionId: string | null }; deduped: boolean }
        expect(created.deduped).toBe(false)
        expect(created.event.sourceKind).toBe('channel')
        expect(created.event.relatedSessionId).toBe(session.id)

        const list = await app.request('/api/system-events?sourceKind=channel')
        expect(list.status).toBe(200)
        const body = await list.json() as { events: Array<{ sourceKind: string; summary: string }> }
        expect(body.events).toHaveLength(1)
        expect(body.events[0]?.sourceKind).toBe('channel')
        expect(body.events[0]?.summary).toBe('CI failed on upstream PR')
    })

    it('dedupes on same idempotencyKey', async () => {
        const store = new Store(':memory:')
        const app = createApp(createEngine(store))
        const body = validChannelBody()

        const first = await postEvent(app, body)
        expect(first.status).toBe(201)
        const firstJson = await first.json() as { event: { id: number }; deduped: boolean }
        expect(firstJson.deduped).toBe(false)

        const second = await postEvent(app, body)
        expect(second.status).toBe(200)
        const secondJson = await second.json() as { event: { id: number }; deduped: boolean }
        expect(secondJson.deduped).toBe(true)
        expect(secondJson.event.id).toBe(firstJson.event.id)

        expect(store.events.count()).toBe(1)
    })

    it('returns 404 for unknown relatedSessionId and 201 when omitted', async () => {
        const store = new Store(':memory:')
        const app = createApp(createEngine(store))

        const missing = await postEvent(app, validChannelBody({
            relatedSessionId: 'missing-session-id',
            idempotencyKey: 'contrib:tiann/hapi#999:fp-missing'
        }))
        expect(missing.status).toBe(404)

        const orphan = await postEvent(app, validChannelBody({
            idempotencyKey: 'contrib:tiann/hapi#999:fp-orphan'
        }))
        expect(orphan.status).toBe(201)
        const orphanJson = await orphan.json() as { event: { relatedSessionId: string | null } }
        expect(orphanJson.event.relatedSessionId).toBeNull()
    })

    it('returns 403 for relatedSessionId in another namespace', async () => {
        const store = new Store(':memory:')
        const foreign = store.sessions.getOrCreateSession(
            'foreign-sess',
            { flavor: 'codex', path: '/tmp' },
            null,
            'other-ns'
        )
        const app = createApp(createEngine(store), 'default')

        const res = await postEvent(app, validChannelBody({
            relatedSessionId: foreign.id,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-ns'
        }))
        expect(res.status).toBe(403)
    })
})
