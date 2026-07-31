import { describe, expect, it } from 'vitest'
import { projectToolResultForBrain } from './toolProjection'

describe('projectToolResultForBrain', () => {
    it('derives total from items length and reports segment counts', () => {
        const full = {
            items: [{ id: 1, title: 'a', status: 'surfaced', priority: 9 }, { id: 2, title: 'b', status: 'new', priority: 5 }],
            candidates: [{ id: 2 }],
            surfaced: [{ id: 1 }],
            held: []
        }
        const lean = projectToolResultForBrain('query_inbox', full) as { total: number; counts: Record<string, number> }
        expect(lean.total).toBe(2)
        expect(lean.counts).toEqual({ candidates: 1, surfaced: 1, held: 0 })
    })

    it('thins inbox items to id/what/status/priority and drops the fat', () => {
        const full = {
            items: [
                {
                    id: 7, title: 'CI auth blocking 3 workers', status: 'surfaced', priority: 90,
                    category: 'blocker', summary: 'long summary…', reasonForPriority: 'shared root cause',
                    sourceEventIds: [1, 2, 3], artifactRefs: ['a'.repeat(400)], createdAt: 1, updatedAt: 2
                },
                { id: 8, title: 'needs a decision', status: 'new', priority: 40, artifactRefs: ['x'.repeat(400)] }
            ]
        }
        const lean = projectToolResultForBrain('query_inbox', full) as { total: number; items: unknown[] }
        expect(lean.total).toBe(2)
        expect(lean.items).toEqual([
            { id: 7, what: 'CI auth blocking 3 workers', status: 'surfaced', priority: 90 },
            { id: 8, what: 'needs a decision', status: 'new', priority: 40 }
        ])
        // the fat is gone
        expect(JSON.stringify(lean)).not.toContain('artifactRefs')
        expect(JSON.stringify(lean)).not.toContain('sourceEventIds')
        // and it is dramatically smaller
        expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length / 3)
    })

    it('preserves incoming (priority) order', () => {
        const full = { total: 3, items: [{ id: 1, priority: 99 }, { id: 2, priority: 50 }, { id: 3, priority: 10 }] }
        const lean = projectToolResultForBrain('query_inbox', full) as { items: Array<{ id: number }> }
        expect(lean.items.map((i) => i.id)).toEqual([1, 2, 3])
    })

    it('thins events to the essentials and drops the fat payload', () => {
        const raw = {
            events: [{
                id: 5, ts: 111, eventType: 'blocked', sourceKind: 'worker', relatedSessionId: 'sess-a',
                attentionCandidate: 1, summary: 'CI auth failing',
                payloadJson: 'x'.repeat(500), idempotencyKey: 'k'.repeat(120), artifactRefs: ['a'.repeat(90)]
            }]
        }
        const lean = projectToolResultForBrain('query_events', raw) as { total: number; events: unknown[] }
        expect(lean.total).toBe(1)
        expect(lean.events[0]).toEqual({ id: 5, ts: 111, type: 'blocked', source: 'worker', session: 'sess-a', attention: 1, what: 'CI auth failing' })
        expect(JSON.stringify(lean)).not.toContain('payloadJson')
        expect(JSON.stringify(lean)).not.toContain('idempotencyKey')
    })

    it('thins workers to id/name/project/state/age', () => {
        const raw = { workers: [{ sessionId: 'sess-a', name: 'web refactor', project: 'hapi', flavor: 'cursor', observedState: 'stale', active: true, lastActivityAt: 999, ageMs: 60000 }] }
        const lean = projectToolResultForBrain('list_active_workers', raw) as { total: number; workers: unknown[] }
        expect(lean.total).toBe(1)
        expect(lean.workers[0]).toEqual({ id: 'sess-a', name: 'web refactor', project: 'hapi', state: 'stale', ageMs: 60000 })
        expect(JSON.stringify(lean)).not.toContain('flavor')
    })

    it('thins open loops to id/name/project/status/action/what/ageDays/bucket', () => {
        const raw = {
            counts: { total: 2, waitingOnYou: 1, halfFinished: 1 },
            openLoops: [
                { sessionId: 'a', name: 'peer-a', project: 'web', flavor: 'cursor', status: 'needs_decision', eventType: 'needs_decision', eventId: 5, action: 'choose target', summary: 'peer-a needs_decision', lastTs: 111, ageMs: 999, ageDays: 10, bucket: 'waiting_on_you' }
            ]
        }
        const lean = projectToolResultForBrain('query_open_loops', raw) as { counts: unknown; openLoops: unknown[] }
        expect(lean.counts).toEqual({ total: 2, waitingOnYou: 1, halfFinished: 1 })
        expect(lean.openLoops[0]).toEqual({ id: 'a', name: 'peer-a', project: 'web', status: 'needs_decision', action: 'choose target', what: 'peer-a needs_decision', ageDays: 10, bucket: 'waiting_on_you' })
        expect(JSON.stringify(lean)).not.toContain('eventId')
        expect(JSON.stringify(lean)).not.toContain('lastTs')
    })

    it('passes un-projected tools through untouched', () => {
        const state = { state: { sessionId: 'x', observedState: 'idle' } }
        expect(projectToolResultForBrain('get_session_state', state)).toBe(state)
    })
})
