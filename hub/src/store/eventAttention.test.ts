import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
    backfillEventAttentionFromEvents,
    ensureOverseerEventsSchema,
    getSystemEventById,
    insertSystemEvent,
    listSystemEvents,
    queryEvents,
    verifyEventAttentionParity,
    EventPrincipalOwnershipError
} from './events'

function openEventsDb(): Database {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    // Minimal sessions table so FK on related_session_id is satisfiable when used.
    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            seq INTEGER NOT NULL DEFAULT 0
        )
    `)
    ensureOverseerEventsSchema(db)
    return db
}

describe('event_attention sidecar', () => {
    it('writes salience to sidecar and leaves events columns at zero', () => {
        const db = openEventsDb()
        const stored = insertSystemEvent(db, {
            ts: 1000,
            sourceKind: 'worker',
            sourceRef: 'sess-1',
            eventType: 'needs_decision',
            attentionCandidate: 1,
            operatorActionRequired: 1,
            riskDetected: 0,
            summary: 'needs a call'
        })
        expect(stored).not.toBeNull()
        expect(stored!.attentionCandidate).toBe(1)
        expect(stored!.operatorActionRequired).toBe(1)
        expect(stored!.riskDetected).toBe(0)

        const legacy = db.prepare(`
            SELECT attention_candidate, operator_action_required, risk_detected
            FROM events WHERE id = ?
        `).get(stored!.id) as {
            attention_candidate: number
            operator_action_required: number
            risk_detected: number
        }
        expect(legacy).toEqual({
            attention_candidate: 0,
            operator_action_required: 0,
            risk_detected: 0
        })

        const sidecar = db.prepare(`
            SELECT attention_candidate, operator_action_required, risk_detected
            FROM event_attention WHERE event_id = ?
        `).get(stored!.id) as {
            attention_candidate: number
            operator_action_required: number
            risk_detected: number
        }
        expect(sidecar).toEqual({
            attention_candidate: 1,
            operator_action_required: 1,
            risk_detected: 0
        })

        const listed = listSystemEvents(db, { attentionCandidate: 1 })
        expect(listed.map((e) => e.id)).toContain(stored!.id)
    })

    it('sparse backfill + parity from legacy columns, then reads via sidecar', () => {
        const db = openEventsDb()
        // Simulate pre-sidecar rows: flags live only on events columns.
        db.prepare(`
            INSERT INTO events (
                ts, source_kind, event_type,
                attention_candidate, operator_action_required, risk_detected,
                summary
            ) VALUES (1, 'worker', 'blocked', 1, 1, 0, 'legacy blocked'),
                     (2, 'worker', 'progress', 0, 0, 0, 'quiet'),
                     (3, 'worker', 'failed', 1, 0, 1, 'legacy fail')
        `).run()

        const changes = backfillEventAttentionFromEvents(db)
        expect(changes).toBe(2)
        expect(backfillEventAttentionFromEvents(db)).toBe(0) // idempotent

        const parity = verifyEventAttentionParity(db)
        expect(parity.mismatches).toBe(0)
        expect(parity.events.attention).toBe(2)
        expect(parity.sidecar.attention).toBe(2)

        const attn = queryEvents(db, { attentionCandidate: 1 })
        expect(attn).toHaveLength(2)
        expect(attn.map((e) => e.summary).sort()).toEqual(['legacy blocked', 'legacy fail'])
    })

    it('records namespace + principal; refuses non-human without owner', () => {
        const db = openEventsDb()
        const ok = insertSystemEvent(db, {
            ts: 1,
            sourceKind: 'overseer',
            sourceRef: 'overseer',
            eventType: 'convo_turn',
            attentionCandidate: 0,
            summary: 'hi',
            namespace: 'default',
            principal: { kind: 'agent', id: 'overseer', onBehalfOf: 'operator' }
        })
        expect(ok?.namespace).toBe('default')
        expect(ok?.principalJson).toContain('"on_behalf_of":"operator"')

        expect(() =>
            insertSystemEvent(db, {
                ts: 2,
                sourceKind: 'overseer',
                eventType: 'convo_turn',
                attentionCandidate: 0,
                summary: 'orphan agent',
                principal: { kind: 'agent', id: 'rogue' }
            })
        ).toThrow(EventPrincipalOwnershipError)

        const otherNs = insertSystemEvent(db, {
            ts: 3,
            sourceKind: 'operator',
            eventType: 'progress',
            attentionCandidate: 0,
            summary: 'other tenancy',
            namespace: 'alice'
        })
        expect(listSystemEvents(db, { namespace: 'default' }).map((e) => e.id)).toContain(ok!.id)
        expect(listSystemEvents(db, { namespace: 'default' }).map((e) => e.id)).not.toContain(otherNs!.id)
        expect(getSystemEventById(db, otherNs!.id)?.namespace).toBe('alice')
    })
})
