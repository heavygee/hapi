import { describe, expect, it } from 'bun:test'
import { buildOverseerSessionIdentity, mergeEventPayloadWithSession } from '@hapi/protocol'
import { Store } from './index'
import type { StoredSession } from './types'
import { deleteSession } from './sessions'
import { backfillInboxDerivedFields, sweepDecayedTerminalItems, FINALE_DECAY_WINDOW_MS } from './inboxItems'
import { Database } from 'bun:sqlite'

function payloadForSession(session: StoredSession, extra: Record<string, unknown> = {}): string {
    const metadata = session.metadata as { flavor?: string; name?: string; path?: string } | null
    return mergeEventPayloadWithSession(extra, buildOverseerSessionIdentity({
        id: session.id,
        flavor: metadata?.flavor ?? 'codex',
        tag: session.tag,
        metadata
    }))
}

describe('Overseer inbox schema (init-gated, not SCHEMA_VERSION)', () => {
    it('fresh DB has inbox tables after Store init', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inbox_items', 'inbox_item_source_events', 'inbox_operator_actions')"
        ).all() as Array<{ name: string }>
        const names = new Set(tables.map((row) => row.name))
        expect(names.has('inbox_items')).toBe(true)
        expect(names.has('inbox_item_source_events')).toBe(true)
        expect(names.has('inbox_operator_actions')).toBe(true)
    })

    it('promotes attention events into one active item per session', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('inbox-promo', { flavor: 'codex', name: 'peer-x' }, null, 'default')

        const blocked = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            sourceRef: 'peer',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'CI failed',
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        expect(blocked).not.toBeNull()
        store.inbox.promoteAttentionEvent(blocked!)

        let items = store.inbox.list({ activeOnly: true })
        expect(items).toHaveLength(1)
        expect(items[0]?.category).toBe('BLOCKED')
        expect(items[0]?.title).toBe('peer-x')
        expect(items[0]?.sourceEventIds).toEqual([blocked!.id])

        const review = store.events.insert({
            ts: 2000,
            sourceKind: 'worker',
            sourceRef: 'peer',
            eventType: 'needs_review',
            attentionCandidate: 1,
            summary: 'Please review diff',
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        store.inbox.promoteAttentionEvent(review!)

        items = store.inbox.list({ activeOnly: true })
        expect(items).toHaveLength(1)
        expect(items[0]?.sourceEventIds.sort()).toEqual([blocked!.id, review!.id].sort())
        expect(items[0]?.category).toBe('REVIEW')
    })

    it('orders active items by coarse rank then oldest-first within tier', () => {
        const store = new Store(':memory:')
        const sessionA = store.sessions.getOrCreateSession('sess-a', { name: 'a' }, null, 'default')
        const sessionB = store.sessions.getOrCreateSession('sess-b', { name: 'b' }, null, 'default')
        const sessionC = store.sessions.getOrCreateSession('sess-c', { name: 'c' }, null, 'default')

        const oldBlocked = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'old blocked',
            relatedSessionId: sessionA.id,
            payloadJson: payloadForSession(sessionA),
            provenance: 'test'
        })
        const newBlocked = store.events.insert({
            ts: 5000,
            sourceKind: 'worker',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'new blocked',
            relatedSessionId: sessionB.id,
            payloadJson: payloadForSession(sessionB),
            provenance: 'test'
        })
        const approval = store.events.insert({
            ts: 3000,
            sourceKind: 'worker',
            eventType: 'approval_requested',
            attentionCandidate: 1,
            summary: 'approve push',
            relatedSessionId: sessionC.id,
            payloadJson: payloadForSession(sessionC),
            provenance: 'test'
        })

        store.inbox.promoteAttentionEvent(oldBlocked!)
        store.inbox.promoteAttentionEvent(newBlocked!)
        store.inbox.promoteAttentionEvent(approval!)

        const items = store.inbox.list({ activeOnly: true })
        expect(items.map((item) => item.title)).toEqual(['c', 'a', 'b'])
    })

    it('uses artifact ref as title when present', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('artifact', { name: 'fallback-name' }, null, 'default')
        const refs = JSON.stringify([{ kind: 'github_pr', title: 'feat: inbox substrate' }])
        const event = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            eventType: 'needs_decision',
            attentionCandidate: 1,
            summary: 'Need merge approval',
            artifactRefs: refs,
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        store.inbox.promoteAttentionEvent(event!)
        const item = store.inbox.list()[0]
        expect(item?.title).toBe('feat: inbox substrate')
        expect(item?.reasonForPriority).toContain('QUESTION tier')
    })

    it('demotes external channel PR items and titles them repo#number', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('pr-babysit', { name: 'peer-x' }, null, 'default')
        const refs = JSON.stringify([
            { kind: 'github_pr', url: 'https://github.com/tiann/hapi/pull/987', repo: 'tiann/hapi', number: 987, source: 'external' }
        ])
        const channelBlocked = store.events.insert({
            ts: 1000,
            sourceKind: 'channel',
            sourceRef: 'contrib-state:tiann/hapi',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'resolve 1 open thread(s)',
            artifactRefs: refs,
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'contrib-state@meta-daily'
        })
        const item = store.inbox.promoteAttentionEvent(channelBlocked!)
        // Title is a human ref, never the bare URL.
        expect(item?.title).toBe('tiann/hapi#987')
        // Channel band = worker rank (20) + offset (100).
        expect(item?.basePriority).toBe(120)

        // A genuine worker blocker on another session still ranks first.
        const worker = store.sessions.getOrCreateSession('real-blocker', { name: 'worker' }, null, 'default')
        const workerBlocked = store.events.insert({
            ts: 2000,
            sourceKind: 'worker',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'CI failed',
            relatedSessionId: worker.id,
            payloadJson: payloadForSession(worker),
            provenance: 'test'
        })
        store.inbox.promoteAttentionEvent(workerBlocked!)
        const ordered = store.inbox.list({ activeOnly: true })
        expect(ordered[0]?.title).toBe('worker')
        expect(ordered[ordered.length - 1]?.title).toBe('tiann/hapi#987')
    })

    it('backfill repairs legacy bare-URL titles and worker-band priority', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const session = store.sessions.getOrCreateSession('legacy', { name: 'legacy' }, null, 'default')
        const refs = JSON.stringify([
            { kind: 'github_pr', url: 'https://github.com/tiann/hapi/pull/958', repo: 'tiann/hapi', number: 958, source: 'external' }
        ])
        const event = store.events.insert({
            ts: 1000,
            sourceKind: 'channel',
            sourceRef: 'contrib-state:tiann/hapi',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'fix failing CI',
            artifactRefs: refs,
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'contrib-state@meta-daily'
        })
        // Simulate a row promoted BEFORE this change: bare-URL title, worker-band priority.
        const inserted = db.prepare(`
            INSERT INTO inbox_items (
                status, priority, base_priority, source_event_ids, related_inbox_ids,
                artifact_refs, attention_class, created_at, updated_at, related_session_id,
                title, category, summary
            ) VALUES (
                'surfaced', 20, 20, ?, '[]', ?, 'live', 1, 1, ?,
                'https://github.com/tiann/hapi/pull/958', 'BLOCKED', 'fix failing CI'
            )
        `).run(JSON.stringify([event!.id]), refs, session.id)
        const id = Number(inserted.lastInsertRowid)

        backfillInboxDerivedFields(db)

        const fixed = store.inbox.getById(id)
        expect(fixed?.title).toBe('tiann/hapi#958')
        expect(fixed?.basePriority).toBe(120)
        expect(fixed?.priority).toBe(120)
        // Status untouched by backfill.
        expect(fixed?.status).toBe('surfaced')
    })

    it('auto-resolves decayed FINALE items but keeps recent ones and non-terminal ones', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const now = 1_000_000_000_000
        const insert = (category: string, updatedAt: number, title: string): number => {
            const res = db.prepare(`
                INSERT INTO inbox_items (
                    status, priority, base_priority, source_event_ids, related_inbox_ids,
                    attention_class, created_at, updated_at, related_session_id, title, category, summary
                ) VALUES (
                    'surfaced', 50, 50, '[]', '[]', 'live', 1, ?, NULL, ?, ?, 's'
                )
            `).run(updatedAt, title, category)
            return Number(res.lastInsertRowid)
        }
        const oldDone = insert('FINALE', now - FINALE_DECAY_WINDOW_MS - 1, 'old-done')
        const freshDone = insert('FINALE', now - 1000, 'fresh-done')
        const blocked = insert('BLOCKED', now - FINALE_DECAY_WINDOW_MS - 1, 'still-blocked')

        const disposed = sweepDecayedTerminalItems(db, now)
        expect(disposed).toBe(1)
        expect(store.inbox.getById(oldDone)?.status).toBe('resolved')
        expect(store.inbox.getById(oldDone)?.resolvedAt).toBe(now)
        expect(store.inbox.getById(freshDone)?.status).toBe('surfaced')
        expect(store.inbox.getById(blocked)?.status).toBe('surfaced')

        // Idempotent: nothing left to sweep.
        expect(sweepDecayedTerminalItems(db, now)).toBe(0)
    })

    it('leaves STALE items alone (worker self-reported stalls share category STALE)', () => {
        // A worker that self-reports status:"stalled" via AGENT_NOTIFY_SUMMARY lands
        // as event_type 'stale' -> category STALE, same as the retired hub-inferred
        // silence detection. Sweeping STALE would eat those live signals, so the
        // sweep must ignore STALE entirely — even when well past the decay window.
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const now = 1_000_000_000_000
        const res = db.prepare(`
            INSERT INTO inbox_items (
                status, priority, base_priority, source_event_ids, related_inbox_ids,
                attention_class, created_at, updated_at, related_session_id, title, category, summary
            ) VALUES (
                'surfaced', 60, 60, '[]', '[]', 'live', ?, ?, NULL,
                'worker self-reported stalled', 'STALE', 'stalled'
            )
        `).run(now - FINALE_DECAY_WINDOW_MS - 1, now - FINALE_DECAY_WINDOW_MS - 1)
        const staleId = Number(res.lastInsertRowid)

        expect(sweepDecayedTerminalItems(db, now)).toBe(0)
        expect(store.inbox.getById(staleId)?.status).toBe('surfaced')
    })

    it('records operator actions as training labels', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('actions', { name: 'actions' }, null, 'default')
        const event = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'blocked',
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        store.inbox.promoteAttentionEvent(event!)
        const itemId = store.inbox.list()[0]!.id

        const updated = store.inbox.recordOperatorAction(itemId, 'done', 'handled offline')
        expect(updated?.status).toBe('resolved')
        expect(updated?.operatorFeedback).toBe('handled offline')

        const db: Database = (store as unknown as { db: Database }).db
        const actions = db.prepare(
            'SELECT action, status_after FROM inbox_operator_actions WHERE inbox_item_id = ?'
        ).all(itemId) as Array<{ action: string; status_after: string }>
        expect(actions).toEqual([{ action: 'done', status_after: 'resolved' }])
    })

    it('deleteSession detaches inbox_items instead of FK-failing', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('inbox-del-tag', {}, null, 'default')
        const db: Database = (store as unknown as { db: Database }).db
        db.prepare(`
            INSERT INTO inbox_items (
                status, priority, base_priority, source_event_ids, related_inbox_ids,
                attention_class, created_at, updated_at, related_session_id, title, category, summary
            ) VALUES (
                'new', 10, 10, '[]', '[]', 'live', 1, 1, ?, 't', 'BLOCKED', 's'
            )
        `).run(session.id)

        expect(deleteSession(db, session.id, 'default')).toBe(true)
        const row = db.prepare(
            'SELECT related_session_id FROM inbox_items LIMIT 1'
        ).get() as { related_session_id: string | null }
        expect(row.related_session_id).toBeNull()
    })

    it('source_event junction supports lookup by event id', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('join', { name: 'join' }, null, 'default')
        const event = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            eventType: 'failed',
            attentionCandidate: 1,
            summary: 'failed',
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        const item = store.inbox.promoteAttentionEvent(event!)
        const db: Database = (store as unknown as { db: Database }).db
        const link = db.prepare(
            'SELECT inbox_item_id FROM inbox_item_source_events WHERE event_id = ?'
        ).get(event!.id) as { inbox_item_id: number }
        expect(link.inbox_item_id).toBe(item!.id)
    })

    it('keeps denormalized title after session delete', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('gone', { name: 'meta HAPI triage' }, null, 'default')
        const event = store.events.insert({
            ts: 1000,
            sourceKind: 'worker',
            eventType: 'blocked',
            attentionCandidate: 1,
            summary: 'blocked',
            relatedSessionId: session.id,
            payloadJson: payloadForSession(session),
            provenance: 'test'
        })
        const item = store.inbox.promoteAttentionEvent(event!)
        expect(item?.title).toBe('meta HAPI triage')

        expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)

        const after = store.inbox.getById(item!.id)
        expect(after?.title).toBe('meta HAPI triage')
        expect(after?.relatedSessionId).toBeNull()
    })
})
