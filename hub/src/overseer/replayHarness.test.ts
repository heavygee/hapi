import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import {
    computeEffectivePriority,
    countStaleItems,
    detectAlarmFlood,
    detectContradictions,
    findRootCauseEventId,
    loadAndReplay,
    parseSnapshot,
    priorityDistribution,
    runPromotionPass
} from './replayHarness'

const FIXTURE_DIR = join(import.meta.dir, '..', '..', '..', 'test', 'fixtures', 'overseer-replay')

function fixture(name: string): string {
    return join(FIXTURE_DIR, `${name}.json`)
}

/** Fixed reference epoch baked into the time-relative fixtures. */
const NOW = 1_700_000_000_000

describe('Overseer replay harness — golden scenarios (prioritization §6)', () => {
    it('loader replays into a sandbox :memory: DB without a production path', () => {
        const ctx = loadAndReplay(fixture('routine-progress-flood'))
        expect((ctx.store as unknown as { _dbPath: string })._dbPath).toBe(':memory:')
        expect(ctx.store.events.count()).toBe(30)
    })

    it('1: 30 routine progress events surface nothing', () => {
        const ctx = loadAndReplay(fixture('routine-progress-flood'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(0)
        expect(ctx.store.events.count()).toBe(30)
    })

    it('2: alarm flood — 11 candidates in a 10-min window is detected', () => {
        const ctx = loadAndReplay(fixture('alarm-flood'))
        const flood = detectAlarmFlood(ctx.store.events.list({ limit: 200 }))
        expect(flood.flood).toBe(true)
        expect(flood.peakCount).toBe(11)
        // routine flood has zero candidates -> no flood
        const calm = loadAndReplay(fixture('routine-progress-flood'))
        expect(detectAlarmFlood(calm.store.events.list({ limit: 200 })).flood).toBe(false)
    })

    it('3: same-session attention events collapse into one item with merged source_event_ids', () => {
        const ctx = loadAndReplay(fixture('same-session-collapse'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(1)
        const merged = inbox[0]!.sourceEventIds.slice().sort((a, b) => a - b)
        expect(merged).toEqual([ctx.eventIdBySid.get(1)!, ctx.eventIdBySid.get(2)!].sort((a, b) => a - b))
        expect(inbox[0]!.category).toBe('REVIEW')
    })

    it('4: idempotent re-emission is stored once and produces one item', () => {
        const ctx = loadAndReplay(fixture('idempotent-reemission'))
        expect(ctx.store.events.count()).toBe(1)
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(1)
        expect(inbox[0]!.category).toBe('QUESTION')
    })

    it('5: blocked_by fan-in — root-cause traversal returns the upstream, not the symptoms', () => {
        const ctx = loadAndReplay(fixture('blocked-by-fanin'))
        const upstream = ctx.eventIdBySid.get(100)!
        for (const symptomSid of [1, 2, 3]) {
            const symptom = ctx.eventIdBySid.get(symptomSid)!
            expect(findRootCauseEventId(ctx.db, symptom)).toBe(upstream)
        }
        // substrate is present even though v0 promotion still surfaces per-session
        const inbox = runPromotionPass(ctx)
        expect(inbox.length).toBeGreaterThanOrEqual(3)
    })

    it('6: approval_requested escalates to the highest coarse priority tier', () => {
        const ctx = loadAndReplay(fixture('approval-escalation'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(1)
        expect(inbox[0]!.category).toBe('APPROVAL')
        expect(inbox[0]!.basePriority).toBe(10)
    })

    it('7: stale-item aging — a 24h+ item is detected and out-prioritizes a fresh higher tier', () => {
        const ctx = loadAndReplay(fixture('aging-and-stale'))
        const items = ctx.store.inbox.list({ activeOnly: true, limit: 200 })
        expect(countStaleItems(items, NOW)).toBe(1)

        const oldCompleted = computeEffectivePriority(50, 1699910000000, NOW)
        const freshReview = computeEffectivePriority(40, 1699999700000, NOW)
        expect(oldCompleted).toBeLessThan(freshReview)

        const dist = priorityDistribution(items)
        expect(dist.low).toBeGreaterThan(dist.medium)
        expect(dist.low).toBeGreaterThan(dist.high)
    })

    it('8: completed with operator action + PR artifact surfaces with the PR handle as title', () => {
        const ctx = loadAndReplay(fixture('completed-review-pr'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(1)
        expect(inbox[0]!.title).toBe('feat(overseer): replay harness v0')
        expect(inbox[0]!.category).toBe('FINALE')
    })

    it('9: completed with no action falls out of the queue but stays queryable', () => {
        const ctx = loadAndReplay(fixture('completed-noise'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(0)
        expect(ctx.store.events.count()).toBe(1)
        expect(ctx.store.events.list({ eventType: 'completed' })).toHaveLength(1)
    })

    it('10 (+1): hub-inferred stale silence is captured-only; worker self-reported stalled promotes', () => {
        const ctx = loadAndReplay(fixture('stale-captured-only'))
        const inbox = runPromotionPass(ctx)
        // both events recorded...
        expect(ctx.store.events.count()).toBe(2)
        // ...but only the explicit self-report promotes to the inbox
        expect(inbox).toHaveLength(1)
        const vocalSessionId = ctx.sessionIdByKey.get('vocal')!
        expect(inbox[0]!.relatedSessionId).toBe(vocalSessionId)
    })

    it('11: CI/worker contradiction is surfaced, not resolved', () => {
        const ctx = loadAndReplay(fixture('ci-contradiction'))
        const contradictions = detectContradictions(ctx.db)
        expect(contradictions).toHaveLength(1)
        expect(contradictions[0]!.failingEventId).toBe(ctx.eventIdBySid.get(1)!)
        expect(contradictions[0]!.passingEventId).toBe(ctx.eventIdBySid.get(2)!)
    })

    it('12: operator noise demotion is recorded as a training label and clears the queue', () => {
        const ctx = loadAndReplay(fixture('operator-noise-demotion'))
        const inbox = runPromotionPass(ctx)
        expect(inbox).toHaveLength(1)
        const dismissed = ctx.store.inbox.recordOperatorAction(inbox[0]!.id, 'dismiss', 'that was noise')
        expect(dismissed!.status).toBe('obsoleted')
        expect(ctx.store.inbox.list({ activeOnly: true })).toHaveLength(0)

        const actions = ctx.db.prepare(
            'SELECT action, status_after FROM inbox_operator_actions WHERE inbox_item_id = ?'
        ).all(inbox[0]!.id) as Array<{ action: string; status_after: string }>
        expect(actions).toEqual([{ action: 'dismiss', status_after: 'obsoleted' }])
    })
})

describe('Overseer replay harness — loader validation', () => {
    const base = {
        name: 'x',
        description: 'x',
        sessions: [{ key: 's' }],
        events: [
            { sid: 1, ts: 1, sessionKey: 's', sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, summary: 'b' }
        ]
    }

    it('rejects a dangling event link', () => {
        const bad = JSON.stringify({ ...base, eventLinks: [{ fromSid: 1, toSid: 999, relationType: 'blocked_by' }] })
        expect(() => parseSnapshot(bad)).toThrow(/unknown toSid/)
    })

    it('rejects an event referencing an unknown session', () => {
        const bad = JSON.stringify({
            ...base,
            events: [{ sid: 1, ts: 1, sessionKey: 'ghost', sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, summary: 'b' }]
        })
        expect(() => parseSnapshot(bad)).toThrow(/unknown session/)
    })

    it('rejects a duplicate event sid', () => {
        const bad = JSON.stringify({
            ...base,
            events: [
                { sid: 1, ts: 1, sessionKey: 's', sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, summary: 'b' },
                { sid: 1, ts: 2, sessionKey: 's', sourceKind: 'worker', eventType: 'blocked', attentionCandidate: 1, summary: 'c' }
            ]
        })
        expect(() => parseSnapshot(bad)).toThrow(/duplicate event sid/)
    })
})
