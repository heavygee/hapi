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

    it('dedupes on same dedupeKey with different idempotencyKey', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('dedupe-key-sess', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))
        const sharedDedupe = 'exit-reflection:dedupe-key-sess:986'

        const first = await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            summary: 'Exit reflection skip: timebox: long reason',
            dedupeKey: sharedDedupe,
            idempotencyKey: 'exit-reflection:dedupe-key-sess:986:hash-a'
        }))
        expect(first.status).toBe(201)

        const second = await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            summary: 'Exit reflection skip: timebox',
            dedupeKey: sharedDedupe,
            idempotencyKey: 'exit-reflection:dedupe-key-sess:986:hash-b'
        }))
        expect(second.status).toBe(200)
        const secondJson = await second.json() as { event: { id: number }; deduped: boolean }
        expect(secondJson.deduped).toBe(true)

        expect(store.events.count()).toBe(1)
    })

    it('scopes dedupeKey to request namespace', async () => {
        const store = new Store(':memory:')
        const defaultSession = store.sessions.getOrCreateSession(
            'dedupe-ns-default',
            { flavor: 'codex', path: '/tmp' },
            null,
            'default'
        )
        const otherSession = store.sessions.getOrCreateSession(
            'dedupe-ns-other',
            { flavor: 'codex', path: '/tmp' },
            null,
            'other-ns'
        )
        const defaultApp = createApp(createEngine(store), 'default')
        const otherApp = createApp(createEngine(store), 'other-ns')
        const sharedDedupe = 'contrib:tiann/hapi#999:blocked'

        const first = await postEvent(defaultApp, validChannelBody({
            relatedSessionId: defaultSession.id,
            dedupeKey: sharedDedupe,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-default'
        }))
        expect(first.status).toBe(201)

        const second = await postEvent(otherApp, validChannelBody({
            relatedSessionId: otherSession.id,
            dedupeKey: sharedDedupe,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-other'
        }))
        expect(second.status).toBe(201)
        const secondJson = await second.json() as { deduped: boolean }
        expect(secondJson.deduped).toBe(false)

        expect(store.events.count()).toBe(2)
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

    it('promotes attention=1 channel events with relatedSessionId into inbox', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('inbox-sess', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))

        const res = await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            eventType: 'progress',
            summary: 'First enter ✅ — waiting on tiann',
            attentionCandidate: 1,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-check'
        }))
        expect(res.status).toBe(201)

        const items = store.inbox.list({ sessionId: session.id, activeOnly: true })
        expect(items).toHaveLength(1)
        expect(items[0]?.summary).toContain('waiting on tiann')
        expect(items[0]?.sourceEventIds).toHaveLength(1)
    })

    it('does not re-promote inbox on deduped replay', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('dedupe-inbox', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))
        const body = validChannelBody({
            relatedSessionId: session.id,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-replay'
        })

        expect((await postEvent(app, body)).status).toBe(201)
        const before = store.inbox.list({ sessionId: session.id })
        expect(before).toHaveLength(1)
        const beforeUpdatedAt = before[0]!.updatedAt
        const beforeSourceIds = [...before[0]!.sourceEventIds]

        const replay = await postEvent(app, body)
        expect(replay.status).toBe(200)
        const replayJson = await replay.json() as { deduped: boolean }
        expect(replayJson.deduped).toBe(true)

        const after = store.inbox.list({ sessionId: session.id })
        expect(after).toHaveLength(1)
        expect(after[0]!.updatedAt).toBe(beforeUpdatedAt)
        expect(after[0]!.sourceEventIds).toEqual(beforeSourceIds)
    })

    it('ADR-001: channel ingest never writes session transcript messages', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('adr-sess', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))

        expect((await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            idempotencyKey: 'contrib:tiann/hapi#999:fp-adr'
        }))).status).toBe(201)

        expect(store.messages.getMessages(session.id)).toHaveLength(0)
        expect(store.events.list({ sourceKind: 'channel' })).toHaveLength(1)
    })

    it('does not promote orphan channel events without relatedSessionId', async () => {
        const store = new Store(':memory:')
        const app = createApp(createEngine(store))

        expect((await postEvent(app, validChannelBody({
            eventType: 'needs_decision',
            summary: 'Orphan ⚠️ PR with no session',
            idempotencyKey: 'contrib:tiann/hapi#999:fp-orphan-inbox'
        }))).status).toBe(201)

        expect(store.inbox.count()).toBe(0)
    })

    it('accepts two same-eventType inserts with different fingerprints/dedupeKeys', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('fp-collide', { flavor: 'codex', path: '/tmp' }, null, 'default')
        const app = createApp(createEngine(store))

        const first = await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            eventType: 'blocked',
            summary: 'CI fail take 1',
            dedupeKey: 'contrib:tiann/hapi#999:blocked:fp-a',
            idempotencyKey: 'contrib:tiann/hapi#999:fp-a'
        }))
        expect(first.status).toBe(201)

        const second = await postEvent(app, validChannelBody({
            relatedSessionId: session.id,
            eventType: 'blocked',
            summary: 'CI fail take 2 — new fingerprint',
            dedupeKey: 'contrib:tiann/hapi#999:blocked:fp-b',
            idempotencyKey: 'contrib:tiann/hapi#999:fp-b'
        }))
        expect(second.status).toBe(201)

        expect(store.events.count()).toBe(2)
        const items = store.inbox.list({ sessionId: session.id, activeOnly: true })
        expect(items).toHaveLength(1)
        expect(items[0]?.sourceEventIds).toHaveLength(2)
        expect(items[0]?.summary).toContain('take 2')
    })
})
