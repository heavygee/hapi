import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'
import { OverseerWriteNotAllowedError, runOverseerTool } from '../overseer/runOverseerTool'
import { OverseerEntity } from './overseerEntity'

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

    it('session-scoped tools resolve unique id prefixes (inactive still returns state)', () => {
        const store = new Store(':memory:')
        const fullId = '96f67085-5dd3-4a10-aa7c-785f72a227c2'
        const collisionId = '96f67085-aaaa-bbbb-cccc-ddddeeeeffff'
        store.sessions.getOrCreateSession(
            'prefix-a',
            { flavor: 'cursor', host: 'local', path: '/tmp/inline-model-error-detect', name: 'cursor inline model-error detect' },
            null,
            'default',
            undefined,
            undefined,
            undefined,
            fullId
        )
        store.events.insert({
            ts: Date.now(), sourceKind: 'worker', eventType: 'completed', attentionCandidate: 0, severity: 2,
            summary: 'done', relatedSessionId: fullId,
            payloadJson: JSON.stringify({ session: { project: 'inline-model-error-detect', name: 'cursor inline model-error detect' } })
        })
        store.messages.addMessage(fullId, agentMessage('shipped the bridge'))

        // Unique 8-char prefix resolves (the live bug: brain truncates, tool used to return null).
        const oUnique = overseer(buildEngine(store))
        const byPrefix = oUnique.getSessionState('96f67085')
        expect(byPrefix).not.toBeNull()
        expect(byPrefix!.sessionId).toBe(fullId)
        expect(byPrefix!.name).toBe('cursor inline model-error detect')
        expect(byPrefix!.workerReportedState).toBe('complete')
        expect(oUnique.getWorkerHealth('96f67085')!.sessionId).toBe(fullId)
        expect(oUnique.getSessionRecentOutput('96f67085').some((c) => c.text.includes('shipped'))).toBe(true)
        expect(oUnique.queryEvents({ sessionId: '96f67085' }).length).toBe(1)

        // Ambiguous prefix must NOT silently pick a winner (rebuild engine so cache sees both).
        store.sessions.getOrCreateSession(
            'prefix-b',
            { flavor: 'codex', path: '/tmp/other', name: 'collision' },
            null,
            'default',
            undefined,
            undefined,
            undefined,
            collisionId
        )
        const oAmbiguous = overseer(buildEngine(store))
        expect(oAmbiguous.getSessionState('96f67085')).toBeNull()
        expect(oAmbiguous.getWorkerHealth('96f67085')).toBeNull()
        expect(oAmbiguous.getSessionRecentOutput('96f67085')).toEqual([])
        expect(oAmbiguous.queryEvents({ sessionId: '96f67085' })).toEqual([])
        // Longer unique prefix still works after the collision appears.
        expect(oAmbiguous.getSessionState('96f67085-5dd3')!.sessionId).toBe(fullId)
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

    it('query_open_loops surfaces cold non-done threads, waiting-on-you first, coldest-first', () => {
        const store = new Store(':memory:')
        const now = Date.now()
        const day = 86_400_000
        const mkSession = (key: string, project: string, name: string) =>
            store.sessions.getOrCreateSession(key, { flavor: 'codex', path: `/tmp/${project}`, name }, null, 'default').id
        const worker = (id: string, project: string, name: string, eventType: string, ts: number, action: string | null, status?: string) => {
            store.events.insert({
                ts, sourceKind: 'worker', eventType, attentionCandidate: 1, severity: 4,
                summary: `${name}: ${eventType}`, relatedSessionId: id,
                payloadJson: JSON.stringify({
                    notify_summary: { status: status ?? eventType, action, summary: `${name} ${eventType}` },
                    suggested_action: action,
                    session: { id, project, name }
                })
            })
        }

        const a = mkSession('a', 'web', 'peer-a')
        const b = mkSession('b', 'api', 'peer-b')
        const c = mkSession('c', 'web', 'peer-c')
        const d = mkSession('d', 'ops', 'peer-d')

        // A: needs_decision 10d cold (waiting_on_you)
        worker(a, 'web', 'peer-a', 'needs_decision', now - 10 * day, 'choose deploy target', 'needs_decision')
        // B: blocked 5d cold (half_finished)
        worker(b, 'api', 'peer-b', 'blocked', now - 5 * day, 'fix CI auth', 'blocked')
        // C: needs_decision 3d then completed 1d -> loop CLOSED, excluded
        worker(c, 'web', 'peer-c', 'needs_decision', now - 3 * day, 'pick lib', 'needs_decision')
        worker(c, 'web', 'peer-c', 'completed', now - 1 * day, null, 'done')
        // D: needs_review 2d with a no-op action -> waiting_on_you, action nulled
        worker(d, 'ops', 'peer-d', 'needs_review', now - 2 * day, 'none', 'needs_review')

        const o = overseer(buildEngine(store))
        const result = o.queryOpenLoops({})

        // C excluded (closed by a later completed); A, D (waiting) before B (half-finished)
        expect(result.openLoops.map((l) => l.sessionId)).toEqual([a, d, b])
        expect(result.counts).toEqual({ total: 3, waitingOnYou: 2, halfFinished: 1 })

        const first = result.openLoops[0]!
        expect(first.bucket).toBe('waiting_on_you')
        expect(first.action).toBe('choose deploy target')
        expect(first.ageDays).toBeGreaterThanOrEqual(9)

        // no-op action is nulled but the loop still surfaces
        const second = result.openLoops[1]!
        expect(second.sessionId).toBe(d)
        expect(second.action).toBeNull()
        expect(second.bucket).toBe('waiting_on_you')

        expect(result.openLoops[2]!.bucket).toBe('half_finished')
    })

    it('query_open_loops honors minAgeMs, project, and bucket filters', () => {
        const store = new Store(':memory:')
        const now = Date.now()
        const day = 86_400_000
        const mkSession = (key: string, project: string) =>
            store.sessions.getOrCreateSession(key, { flavor: 'codex', path: `/tmp/${project}` }, null, 'default').id
        const worker = (id: string, project: string, eventType: string, ts: number) => {
            store.events.insert({
                ts, sourceKind: 'worker', eventType, attentionCandidate: 1, severity: 4,
                summary: `${id}: ${eventType}`, relatedSessionId: id,
                payloadJson: JSON.stringify({ notify_summary: { status: eventType, action: 'do a thing' }, session: { id, project } })
            })
        }
        const a = mkSession('a', 'web')
        const b = mkSession('b', 'api')
        const d = mkSession('d', 'ops')
        worker(a, 'web', 'needs_decision', now - 10 * day)
        worker(b, 'api', 'blocked', now - 5 * day)
        worker(d, 'ops', 'needs_review', now - 2 * day)

        const o = overseer(buildEngine(store))
        expect(o.queryOpenLoops({ minAgeMs: 4 * day }).openLoops.map((l) => l.sessionId)).toEqual([a, b])
        expect(o.queryOpenLoops({ project: 'web' }).openLoops.map((l) => l.sessionId)).toEqual([a])
        expect(o.queryOpenLoops({ bucket: 'half_finished' }).openLoops.map((l) => l.sessionId)).toEqual([b])
        expect(o.queryOpenLoops({ limit: 1 }).openLoops.length).toBe(1)
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

describe('OverseerEntity dispositions (Stage 1 keystone)', () => {
    function promoteItem(
        store: Store,
        opts: { key: string; eventType: string; project: string; artifactRefs?: string | null }
    ): { itemId: number } {
        const session = store.sessions.getOrCreateSession(
            opts.key,
            { flavor: 'codex', path: '/tmp/web' },
            null,
            'default'
        )
        const event = store.events.insert({
            ts: Date.now(),
            sourceKind: 'worker',
            sourceRef: opts.key,
            eventType: opts.eventType,
            attentionCandidate: 1,
            severity: 4,
            summary: `${opts.eventType} on ${opts.project}`,
            relatedSessionId: session.id,
            artifactRefs: opts.artifactRefs ?? null,
            payloadJson: JSON.stringify({ session: { project: opts.project, name: opts.key } })
        })
        expect(event).not.toBeNull()
        const item = store.inbox.promoteAttentionEvent(event!)
        expect(item).not.toBeNull()
        return { itemId: item!.id }
    }

    it('record_disposition writes the R8 snapshot and returns a tombstone', () => {
        const store = new Store(':memory:')
        const { itemId } = promoteItem(store, {
            key: 'disp-1',
            eventType: 'needs_decision',
            project: 'hapi',
            artifactRefs: JSON.stringify([{ kind: 'github_pr', url: 'https://github.com/tiann/hapi/pull/42' }])
        })
        const o = overseer(buildEngine(store))

        const res = o.recordDisposition({ itemId, action: 'done', feedback: 'ship it' })
        expect(res.ok).toBe(true)
        expect(res.action).toBe('done')
        expect(res.statusAfter).toBe('resolved')
        expect(res.tombstone).toContain(`#${itemId}`)
        expect(res.tombstone.toLowerCase()).toContain('resolved')

        // The disposition row carries the frozen predicate vocabulary (R8).
        const listed = o.queryDispositions({})
        expect(listed.mode).toBe('list')
        expect(listed.total).toBe(1)
        const row = listed.rows?.[0]
        expect(row?.itemId).toBe(itemId)
        expect(row?.action).toBe('done')
        expect(row?.category).toBe('QUESTION')
        expect(row?.project).toBe('hapi')
        expect(row?.eventType).toBe('needs_decision')
        expect(row?.sourceRef).toBe('disp-1')
        expect(row?.artifactKind).toBe('github_pr')
        expect(row?.feedback).toBe('ship it')
    })

    it('record_disposition derives artifact_kind + repo from the as-seen artifact', () => {
        const store = new Store(':memory:')
        const { itemId } = promoteItem(store, {
            key: 'disp-repo',
            eventType: 'needs_review',
            project: 'hapi',
            artifactRefs: JSON.stringify([{ kind: 'github_pr', url: 'https://github.com/tiann/hapi/pull/99' }])
        })
        const o = overseer(buildEngine(store))
        o.recordDisposition({ itemId, action: 'dismiss' })

        const cluster = o.queryDispositions({ groupBy: ['repo', 'artifact_kind'], minCount: 1 })
        expect(cluster.mode).toBe('cluster')
        const c = cluster.clusters?.[0]
        expect(c?.keys.repo).toBe('tiann/hapi')
        expect(c?.keys.artifact_kind).toBe('github_pr')
        expect(c?.count).toBe(1)
    })

    it('query_dispositions cluster mode groups by predicate columns with HAVING minCount', () => {
        const store = new Store(':memory:')
        const a = promoteItem(store, { key: 'c-a', eventType: 'needs_decision', project: 'hapi' })
        const b = promoteItem(store, { key: 'c-b', eventType: 'needs_decision', project: 'hapi' })
        const c = promoteItem(store, { key: 'c-c', eventType: 'blocked', project: 'lockhouse' })
        const o = overseer(buildEngine(store))
        o.recordDisposition({ itemId: a.itemId, action: 'done' })
        o.recordDisposition({ itemId: b.itemId, action: 'done' })
        o.recordDisposition({ itemId: c.itemId, action: 'dismiss' })

        // Two QUESTION/done, one BLOCKED/dismiss. minCount 2 keeps only the dominant bucket.
        const clusters = o.queryDispositions({ groupBy: ['category', 'action'], minCount: 2 })
        expect(clusters.clusters?.length).toBe(1)
        const only = clusters.clusters?.[0]
        expect(only?.keys.category).toBe('QUESTION')
        expect(only?.keys.action).toBe('done')
        expect(only?.count).toBe(2)
    })

    it('query_dispositions cluster mode respects limit', () => {
        const store = new Store(':memory:')
        const o = overseer(buildEngine(store))
        for (let i = 0; i < 4; i++) {
            const { itemId } = promoteItem(store, {
                key: `lim-${i}`,
                eventType: 'needs_decision',
                project: `proj-${i}`
            })
            o.recordDisposition({ itemId, action: 'done' })
        }
        const clusters = o.queryDispositions({ groupBy: ['project'], minCount: 1, limit: 2 })
        expect(clusters.clusters?.length).toBe(2)
        expect(clusters.total).toBe(2)
    })

    it('snoozed inbox items stay hidden until wake time, then resurface on read', () => {
        const store = new Store(':memory:')
        const { itemId } = promoteItem(store, { key: 'snooze-hide', eventType: 'blocked', project: 'hapi' })
        const o = overseer(buildEngine(store))
        const future = Date.now() + 86_400_000
        o.recordDisposition({ itemId, action: 'snooze', snoozedUntil: future })

        expect(o.queryInbox({}).items).toHaveLength(0)

        const db: Database = (store as unknown as { db: Database }).db
        db.prepare(
            'UPDATE inbox_items SET snoozed_until = ?, updated_at = ? WHERE id = ?'
        ).run(Date.now() - 1000, Date.now() - 1000, itemId)

        const afterWake = o.queryInbox({})
        expect(afterWake.items).toHaveLength(1)
        expect(afterWake.items[0]?.status).toBe('surfaced')
    })

    it('record_disposition rejects unknown item and snooze-without-timestamp without writing', () => {
        const store = new Store(':memory:')
        const o = overseer(buildEngine(store))

        const missing = o.recordDisposition({ itemId: 9999, action: 'done' })
        expect(missing.ok).toBe(false)

        const { itemId } = promoteItem(store, { key: 'sn', eventType: 'blocked', project: 'hapi' })
        const badSnooze = o.recordDisposition({ itemId, action: 'snooze' })
        expect(badSnooze.ok).toBe(false)
        // Nothing recorded on either failure.
        expect(o.queryDispositions({}).total).toBe(0)
    })

    it('record_disposition is gated: runOverseerTool refuses the write unless allowWrites', async () => {
        const store = new Store(':memory:')
        const { itemId } = promoteItem(store, { key: 'gate', eventType: 'blocked', project: 'hapi' })
        const o = overseer(buildEngine(store))
        await expect(runOverseerTool(o, 'record_disposition', { itemId, action: 'done' })).rejects.toBeInstanceOf(
            OverseerWriteNotAllowedError
        )
        // With writes allowed (the conversational path) it lands.
        const res = await runOverseerTool(o, 'record_disposition', { itemId, action: 'done' }, true) as {
            ok: boolean
        }
        expect(res.ok).toBe(true)
    })

    it('ping_session resolves by sessionId / itemId and returns a tombstone via injected relay', async () => {
        const store = new Store(':memory:')
        const { itemId } = promoteItem(store, {
            key: 'expenses',
            eventType: 'blocked',
            project: 'expenses'
        })
        const item = store.inbox.getById(itemId)!
        const sessionId = item.relatedSessionId!
        expect(sessionId).toBeTruthy()

        let lastRelay: { sessionId: string; message: string } | undefined
        const o = new OverseerEntity({
            events: store.events,
            inbox: store.inbox,
            messages: store.messages,
            getSession: (id) => {
                const s = store.sessions.getSession(id)
                if (!s) return undefined
                return { ...s, active: true, namespace: s.namespace || 'default' } as never
            },
            getSessions: () => {
                const s = store.sessions.getSession(sessionId)
                return s ? [{ ...s, active: true, namespace: s.namespace || 'default' } as never] : []
            },
            relayToSession: async ({ sessionId: sid, message }) => {
                lastRelay = { sessionId: sid, message }
                return { ok: true, resumed: false }
            }
        })

        const byItem = await o.pingSession({
            itemId,
            message: 'Please draft the Cursor Pro June note.'
        })
        expect(byItem.ok).toBe(true)
        expect(byItem.sessionId).toBe(sessionId)
        expect(byItem.tombstone).toContain('Relayed')
        expect(lastRelay).toEqual({
            sessionId,
            message: 'Please draft the Cursor Pro June note.'
        })
        const byPrefix = await o.pingSession({
            sessionId: sessionId.slice(0, 8),
            message: 'Second ping'
        })
        expect(byPrefix.ok).toBe(true)
        expect(byPrefix.sessionId).toBe(sessionId)

        await expect(runOverseerTool(o, 'ping_session', { sessionId, message: 'x' })).rejects.toBeInstanceOf(
            OverseerWriteNotAllowedError
        )
    })
})
