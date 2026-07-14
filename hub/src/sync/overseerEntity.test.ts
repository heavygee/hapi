import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'
import type { OverseerEntity } from './overseerEntity'

function makeEngine(): { store: Store; engine: SyncEngine } {
    const store = new Store(':memory:')
    return { store, engine: buildEngine(store) }
}

function buildEngine(store: Store): SyncEngine {
    const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
    return new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)
}

function agentMessage(text: string): unknown {
    return { role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } }
}

function overseer(engine: SyncEngine): OverseerEntity {
    return engine.getOverseer()
}

describe('OverseerEntity read-only tools', () => {
    it('query_events filters by severity, type, source, and project', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('evt', { flavor: 'codex', path: '/tmp/web' }, null, 'default')
        const now = Date.now()
        store.events.insert({
            ts: now, sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, severity: 4,
            summary: 'blocked on CI', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'web' } })
        })
        store.events.insert({
            ts: now, sourceKind: 'worker', eventType: 'progress', attentionCandidate: 0, severity: 1,
            summary: 'progress tick', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'web' } })
        })
        store.events.insert({
            ts: now, sourceKind: 'system', eventType: 'stale', attentionCandidate: 0, severity: 3,
            summary: 'silent', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'api' } })
        })

        const engine = buildEngine(store)
        const o = overseer(engine)

        expect(o.queryEvents({ severityMin: 4 }).map((e) => e.summary)).toEqual(['blocked on CI'])
        expect(o.queryEvents({ eventType: 'progress' }).map((e) => e.summary)).toEqual(['progress tick'])
        expect(o.queryEvents({ sourceKind: 'system' }).map((e) => e.summary)).toEqual(['silent'])
        expect(o.queryEvents({ project: 'api' }).map((e) => e.summary)).toEqual(['silent'])
        expect(o.queryEvents({ attentionCandidate: 1 }).map((e) => e.summary)).toEqual(['blocked on CI'])
        expect(o.queryEvents({}).length).toBe(3)
    })

    it('query_inbox groups candidates / surfaced / held', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('inbox', { flavor: 'claude', path: '/tmp/web' }, null, 'default')
        const event = store.events.insert({
            ts: Date.now(), sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, severity: 4,
            summary: 'CI auth fail', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'web', name: 'peer-15' } })
        })
        expect(event).not.toBeNull()
        const item = store.inbox.promoteAttentionEvent(event!)
        expect(item).not.toBeNull()

        const engine = buildEngine(store)
        const result = overseer(engine).queryInbox({})
        expect(result.items.length).toBe(1)
        expect(result.candidates.length).toBe(1)
        expect(result.candidates[0]?.status).toBe('new')
        expect(result.surfaced.length).toBe(0)
        expect(result.held.length).toBe(0)
    })

    it('explain_priority recites the stored reason and the provenance trail', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('prio', { flavor: 'claude', path: '/tmp/web' }, null, 'default')
        const event = store.events.insert({
            ts: Date.now(), sourceKind: 'worker', eventType: 'needs_decision', attentionCandidate: 1, severity: 5,
            summary: 'pick a deploy target', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'web', name: 'peer-3' } })
        })
        const item = store.inbox.promoteAttentionEvent(event!)
        expect(item).not.toBeNull()

        const engine = buildEngine(store)
        const explanation = overseer(engine).explainPriority(item!.id)
        expect(explanation).not.toBeNull()
        expect(explanation!.reasonForPriority).toBe(item!.reasonForPriority)
        expect(explanation!.reasonForPriority).toBeTruthy()
        expect(explanation!.sourceEventIds).toContain(event!.id)
        expect(explanation!.sourceEvents.map((e) => e.summary)).toContain('pick a deploy target')

        expect(overseer(engine).explainPriority(99999)).toBeNull()
    })

    it('get_session_state + get_worker_health combine reported/observed/inferred', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('health', { flavor: 'codex', host: 'local', path: '/tmp/api', name: 'peer-7' }, null, 'default')
        store.events.insert({
            ts: Date.now(), sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, severity: 4,
            summary: 'blocked on migration', relatedSessionId: session.id,
            payloadJson: JSON.stringify({ session: { project: 'api', name: 'peer-7' } })
        })

        const engine = buildEngine(store)
        const state = overseer(engine).getSessionState(session.id)
        expect(state).not.toBeNull()
        expect(state!.workerReportedState).toBe('blocked')
        expect(state!.project).toBe('api')

        const health = overseer(engine).getWorkerHealth(session.id)
        expect(health).not.toBeNull()
        expect(health!.reportedState).toBe('blocked')
        // blocked is a terminal reported state -> inferred follows it with high confidence
        expect(health!.inferredState).toBe('blocked')
        expect(health!.inferredConfidence).toBeGreaterThan(0.8)
        expect(health!.signals.some((s) => s.includes('worker-reported: blocked'))).toBe(true)

        expect(overseer(engine).getSessionState('does-not-exist')).toBeNull()
        expect(overseer(engine).getWorkerHealth('does-not-exist')).toBeNull()
    })

    it('get_session_recent_output returns last transcript chunks with roles', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('out', { flavor: 'codex', path: '/tmp/web' }, null, 'default')
        store.messages.addMessage(session.id, { role: 'user', content: 'refactor auth' })
        store.messages.addMessage(session.id, agentMessage('Refactored the auth module'))

        const engine = buildEngine(store)
        const chunks = overseer(engine).getSessionRecentOutput(session.id, 10)
        expect(chunks.length).toBe(2)
        expect(chunks.map((c) => c.role)).toEqual(['operator', 'worker'])
        expect(chunks[1]?.text).toBe('Refactored the auth module')
    })

    it('list_active_workers builds a roster filterable by project', () => {
        const store = new Store(':memory:')
        store.sessions.getOrCreateSession('w1', { flavor: 'codex', host: 'local', path: '/tmp/web', name: 'peer-1' }, null, 'default')
        store.sessions.getOrCreateSession('w2', { flavor: 'claude', host: 'local', path: '/tmp/api', name: 'peer-2' }, null, 'default')

        const engine = buildEngine(store)
        const all = overseer(engine).listActiveWorkers({})
        expect(all.length).toBe(2)
        const web = overseer(engine).listActiveWorkers({ project: 'web' })
        expect(web.length).toBe(1)
        expect(web[0]?.project).toBe('web')
    })

    it('recordConvoTurn writes a memory-bearing convo_turn event (never an inbox item)', () => {
        const { store, engine } = makeEngine()
        const inboxBefore = store.inbox.count()
        const event = overseer(engine).recordConvoTurn({
            operatorText: 'what needs me next?',
            overseerText: 'peer-15 is blocked on CI auth — 12 minutes old.'
        })
        expect(event).not.toBeNull()
        expect(event!.eventType).toBe('convo_turn')
        expect(event!.attentionCandidate).toBe(0)
        expect(event!.sourceKind).toBe('overseer')
        // memory-bearing: must NOT have created an inbox item
        expect(store.inbox.count()).toBe(inboxBefore)

        const convoEvents = engine.getSystemEvents({ eventType: 'convo_turn' })
        expect(convoEvents.length).toBe(1)
    })
})
