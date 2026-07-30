/**
 * Overseer replay / evaluation harness (Step 2.75).
 *
 * The harness loads a captured event-stream snapshot from disk, replays it into
 * a sandbox (`:memory:`) Store WITHOUT touching the production DB, runs the
 * promotion + prioritization logic once, and exposes the analytic helpers the
 * golden-scenario assertions need (alarm-flood / stale / priority-distribution
 * KPIs from EEMUA 191, blocked_by root-cause traversal, contradiction
 * detection, and the §5 effective-priority scoring sketch).
 *
 * See docs/plans/2026-06-03-overseer-prioritization.md §6 (replay harness) and
 * the golden-scenario table, plus docs/plans/2026-06-03-overseer-build-sequence.md
 * Step 2.75. Fixtures are synthetic (contracts §7) and live under
 * test/fixtures/overseer-replay/.
 */
import { readFileSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import {
    buildOverseerSessionIdentity,
    mergeEventPayloadWithSession,
    type OverseerSessionIdentity
} from '@hapi/protocol'
import { Store } from '../store'
import type { StoredInboxItem } from '../store/inboxStore'
import type { StoredSystemEvent } from '../store/events'

/** A single captured event in a snapshot. `sid` is a snapshot-local id used for linking. */
export type SnapshotEvent = {
    sid: number
    ts: number
    sessionKey?: string | null
    sourceKind: 'worker' | 'overseer' | 'operator' | 'system' | 'channel'
    sourceRef?: string | null
    sinkKind?: string | null
    sinkRef?: string | null
    eventType: string
    attentionCandidate: 0 | 1
    operatorActionRequired?: 0 | 1
    riskDetected?: 0 | 1
    summary: string
    artifactRefs?: unknown
    dedupeKey?: string | null
    idempotencyKey?: string | null
    expiresAt?: number | null
    provenance?: string | null
    confidence?: number | null
    severity?: number | null
    payload?: Record<string, unknown>
}

export type SnapshotSession = {
    key: string
    tag?: string | null
    flavor?: string
    name?: string | null
    path?: string | null
}

export type SnapshotEventLink = {
    fromSid: number
    toSid: number
    relationType: string
    metadata?: unknown
}

/** Pre-seeded baseline inbox item (for aging / stale / distribution scenarios). */
export type SnapshotInboxItem = {
    status: string
    basePriority: number
    category: string
    title: string
    summary: string
    createdAt: number
    sessionKey?: string | null
    sourceSids?: number[]
    attentionClass?: string
}

/**
 * Worker-facing dispatch records for the one-boss invariant (ADR-001).
 * Empty in Step 2.75 fixtures (no dispatch writer yet) -> invariant passes
 * vacuously. Step 4 populates these from the real dispatch envelope + messages
 * tables and the same assertion shape activates automatically.
 */
export type SnapshotDispatchEnvelope = {
    idempotencyKey: string
    messageId: string
    origin?: string
    rationale?: string
    relatedEventIds?: number[]
    confirmationSource?: string
}

export type SnapshotWorkerMessage = {
    id: string
    sessionKey?: string | null
    role: string
    renderedInstruction: string
    metadata?: Record<string, unknown>
}

export type ReplaySnapshot = {
    name: string
    description: string
    sessions: SnapshotSession[]
    events: SnapshotEvent[]
    eventLinks?: SnapshotEventLink[]
    inboxItems?: SnapshotInboxItem[]
    dispatchEnvelopes?: SnapshotDispatchEnvelope[]
    workerMessages?: SnapshotWorkerMessage[]
}

export type ReplayContext = {
    store: Store
    db: Database
    snapshot: ReplaySnapshot
    /** snapshot-local event id (sid) -> real inserted event id. */
    eventIdBySid: Map<number, number>
    /** snapshot session key -> denormalized identity used in event payloads. */
    identityByKey: Map<string, OverseerSessionIdentity>
    /** snapshot session key -> real session id. */
    sessionIdByKey: Map<string, string>
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(`[overseer-replay] invalid snapshot: ${message}`)
    }
}

/** Parse + structurally validate a snapshot JSON file. Throws on malformed input. */
export function parseSnapshot(raw: string): ReplaySnapshot {
    const parsed = JSON.parse(raw) as Partial<ReplaySnapshot>
    assert(typeof parsed.name === 'string', 'missing name')
    assert(typeof parsed.description === 'string', 'missing description')
    assert(Array.isArray(parsed.sessions), 'sessions must be an array')
    assert(Array.isArray(parsed.events), 'events must be an array')

    const sessionKeys = new Set<string>()
    for (const session of parsed.sessions!) {
        assert(typeof session.key === 'string' && session.key.length > 0, 'session.key required')
        assert(!sessionKeys.has(session.key), `duplicate session key ${session.key}`)
        sessionKeys.add(session.key)
    }

    const sids = new Set<number>()
    for (const event of parsed.events!) {
        assert(typeof event.sid === 'number', 'event.sid required')
        assert(!sids.has(event.sid), `duplicate event sid ${event.sid}`)
        sids.add(event.sid)
        assert(typeof event.ts === 'number', `event ${event.sid} missing ts`)
        assert(typeof event.eventType === 'string', `event ${event.sid} missing eventType`)
        assert(
            event.attentionCandidate === 0 || event.attentionCandidate === 1,
            `event ${event.sid} attentionCandidate must be 0 or 1`
        )
        if (event.sessionKey != null) {
            assert(sessionKeys.has(event.sessionKey), `event ${event.sid} references unknown session ${event.sessionKey}`)
        }
    }

    for (const link of parsed.eventLinks ?? []) {
        assert(sids.has(link.fromSid), `link references unknown fromSid ${link.fromSid}`)
        assert(sids.has(link.toSid), `link references unknown toSid ${link.toSid}`)
        assert(typeof link.relationType === 'string', 'link.relationType required')
    }

    return parsed as ReplaySnapshot
}

export function loadSnapshot(path: string): ReplaySnapshot {
    return parseSnapshot(readFileSync(path, 'utf8'))
}

function serializeArtifactRefs(refs: unknown): string | null {
    if (refs == null) return null
    if (typeof refs === 'string') return refs
    return JSON.stringify(refs)
}

/**
 * Replay a snapshot into a fresh sandbox Store. Never touches the production DB:
 * the Store is constructed with `:memory:`.
 */
export function replaySnapshot(snapshot: ReplaySnapshot): ReplayContext {
    const store = new Store(':memory:')
    const db = (store as unknown as { db: Database }).db

    const identityByKey = new Map<string, OverseerSessionIdentity>()
    const sessionIdByKey = new Map<string, string>()

    for (const session of snapshot.sessions) {
        const metadata = {
            flavor: session.flavor ?? 'claude',
            name: session.name ?? undefined,
            path: session.path ?? undefined
        }
        const created = store.sessions.getOrCreateSession(
            session.tag ?? session.key,
            metadata,
            null,
            'default'
        )
        sessionIdByKey.set(session.key, created.id)
        identityByKey.set(
            session.key,
            buildOverseerSessionIdentity({
                id: created.id,
                flavor: session.flavor ?? 'claude',
                tag: session.tag ?? null,
                metadata
            })
        )
    }

    // Replay in chronological (stream) order; preserve array order for ties.
    const ordered = snapshot.events
        .map((event, index) => ({ event, index }))
        .sort((a, b) => (a.event.ts - b.event.ts) || (a.index - b.index))

    const eventIdBySid = new Map<number, number>()

    for (const { event } of ordered) {
        const sessionId = event.sessionKey ? sessionIdByKey.get(event.sessionKey) ?? null : null
        const identity = event.sessionKey ? identityByKey.get(event.sessionKey) : undefined
        const payloadJson = identity
            ? mergeEventPayloadWithSession(event.payload ?? {}, identity)
            : event.payload
                ? JSON.stringify(event.payload)
                : null

        const stored = store.events.insert({
            ts: event.ts,
            sourceKind: event.sourceKind,
            sourceRef: event.sourceRef ?? null,
            sinkKind: event.sinkKind ?? null,
            sinkRef: event.sinkRef ?? null,
            eventType: event.eventType,
            attentionCandidate: event.attentionCandidate,
            operatorActionRequired: event.operatorActionRequired ?? 0,
            riskDetected: event.riskDetected ?? 0,
            summary: event.summary,
            payloadJson,
            artifactRefs: serializeArtifactRefs(event.artifactRefs),
            relatedSessionId: sessionId,
            dedupeKey: event.dedupeKey ?? null,
            expiresAt: event.expiresAt ?? null,
            provenance: event.provenance ?? null,
            idempotencyKey: event.idempotencyKey ?? null,
            confidence: event.confidence ?? null,
            severity: event.severity ?? null
        })
        assert(stored, `event ${event.sid} failed to insert`)
        eventIdBySid.set(event.sid, stored.id)
    }

    for (const link of snapshot.eventLinks ?? []) {
        store.events.linkEvents({
            fromEventId: eventIdBySid.get(link.fromSid)!,
            toEventId: eventIdBySid.get(link.toSid)!,
            relationType: link.relationType,
            createdAt: Date.now(),
            metadataJson: link.metadata != null ? JSON.stringify(link.metadata) : null
        })
    }

    for (const item of snapshot.inboxItems ?? []) {
        const sessionId = item.sessionKey ? sessionIdByKey.get(item.sessionKey) ?? null : null
        const sourceEventIds = (item.sourceSids ?? [])
            .map((sid) => eventIdBySid.get(sid))
            .filter((id): id is number => typeof id === 'number')
        db.prepare(`
            INSERT INTO inbox_items (
                status, priority, base_priority, source_event_ids, related_inbox_ids,
                attention_class, created_at, updated_at, related_session_id, title, category, summary
            ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
        `).run(
            item.status,
            item.basePriority,
            item.basePriority,
            JSON.stringify(sourceEventIds),
            item.attentionClass ?? 'live',
            item.createdAt,
            item.createdAt,
            sessionId,
            item.title,
            item.category,
            item.summary
        )
    }

    return { store, db, snapshot, eventIdBySid, identityByKey, sessionIdByKey }
}

/**
 * Run-once promotion + prioritization entry point. Promotes every replayed
 * attention-candidate event into the inbox (mirroring the recorder's
 * insert-time promotion) and returns the resulting active inbox queue.
 */
export function runPromotionPass(ctx: ReplayContext): StoredInboxItem[] {
    const events = ctx.store.events.list({ limit: 200 })
    // events.list returns newest-first; promote oldest-first to mimic the stream.
    const chronological = [...events].sort((a, b) => a.id - b.id)
    for (const event of chronological) {
        if (event.attentionCandidate === 1) {
            ctx.store.inbox.promoteAttentionEvent(event)
        }
    }
    return ctx.store.inbox.list({ activeOnly: true, limit: 200 })
}

export function loadAndReplay(path: string): ReplayContext {
    return replaySnapshot(loadSnapshot(path))
}

// ---------------------------------------------------------------------------
// Analytic helpers — KPIs (EEMUA 191 / ISA-18.2) + §5 scoring sketch.
// ---------------------------------------------------------------------------

export const ALARM_FLOOD_WINDOW_MS = 10 * 60 * 1000
export const ALARM_FLOOD_THRESHOLD = 10
export const STALE_ITEM_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * §5 effective-priority sketch (v0). Lower number = more urgent. Aging bumps an
 * item's urgency over time (classical OS aging / starvation prevention) by
 * subtracting an age-proportional amount from the coarse base, floored so a
 * routine item can never overtake a genuine APPROVAL/BLOCKED tier.
 */
export function computeEffectivePriority(
    basePriority: number,
    createdAt: number,
    now: number = Date.now(),
    agingSlopePerHour = 2,
    maxAgingBump = 45
): number {
    const ageHours = Math.max(0, (now - createdAt) / 3_600_000)
    const bump = Math.min(maxAgingBump, ageHours * agingSlopePerHour)
    return basePriority - bump
}

export type AlarmFloodResult = {
    flood: boolean
    peakCount: number
    windowMs: number
    threshold: number
}

/** Sliding-window surface-rate / alarm-flood detection over attention candidates. */
export function detectAlarmFlood(
    events: StoredSystemEvent[],
    windowMs: number = ALARM_FLOOD_WINDOW_MS,
    threshold: number = ALARM_FLOOD_THRESHOLD
): AlarmFloodResult {
    const candidates = events
        .filter((e) => e.attentionCandidate === 1)
        .map((e) => e.ts)
        .sort((a, b) => a - b)

    let peak = 0
    let start = 0
    for (let end = 0; end < candidates.length; end += 1) {
        while (candidates[end] - candidates[start] >= windowMs) start += 1
        peak = Math.max(peak, end - start + 1)
    }
    return { flood: peak > threshold, peakCount: peak, windowMs, threshold }
}

export function countStaleItems(
    items: StoredInboxItem[],
    now: number = Date.now(),
    thresholdMs: number = STALE_ITEM_THRESHOLD_MS
): number {
    return items.filter(
        (item) => isActiveStatus(item.status) && now - item.createdAt >= thresholdMs
    ).length
}

function isActiveStatus(status: string): boolean {
    return status === 'new' || status === 'surfaced' || status === 'deferred' || status === 'snoozed'
}

export type PriorityBucket = 'high' | 'medium' | 'low'

export function priorityBucket(basePriority: number): PriorityBucket {
    if (basePriority <= 20) return 'high'
    if (basePriority <= 45) return 'medium'
    return 'low'
}

export function priorityDistribution(items: StoredInboxItem[]): Record<PriorityBucket, number> {
    const dist: Record<PriorityBucket, number> = { high: 0, medium: 0, low: 0 }
    for (const item of items) dist[priorityBucket(item.basePriority)] += 1
    return dist
}

type EventLinkRow = { from_event_id: number; to_event_id: number }

/**
 * Walk `relation` edges (default `blocked_by`) from a symptom event up to the
 * terminal upstream event — the root cause. Surfacing the root, not the
 * symptoms, is the prioritization §6 requirement for the fan-in blocked case.
 * Cycle-safe.
 */
export function findRootCauseEventId(
    db: Database,
    fromEventId: number,
    relation = 'blocked_by'
): number {
    const stmt = db.prepare(
        'SELECT from_event_id, to_event_id FROM event_links WHERE from_event_id = ? AND relation_type = ?'
    )
    const seen = new Set<number>([fromEventId])
    let current = fromEventId
    for (;;) {
        const next = stmt.get(current, relation) as EventLinkRow | undefined
        if (!next || seen.has(next.to_event_id)) break
        seen.add(next.to_event_id)
        current = next.to_event_id
    }
    return current
}

export type Contradiction = {
    sessionId: string
    failingEventId: number
    passingEventId: number
    note: string
}

/**
 * Detect sessions that report both failure and success without resolution.
 * The Overseer must SURFACE the contradiction, not silently pick a winner
 * (prioritization §6). Returns descriptors only — no resolution.
 */
export function detectContradictions(db: Database): Contradiction[] {
    const rows = db.prepare(`
        SELECT f.related_session_id AS sid, f.id AS failing, c.id AS passing
        FROM events f
        JOIN events c
          ON c.related_session_id = f.related_session_id
        WHERE f.related_session_id IS NOT NULL
          AND f.event_type IN ('failed', 'blocked')
          AND c.event_type = 'completed'
          AND c.ts >= f.ts
    `).all() as Array<{ sid: string; failing: number; passing: number }>

    return rows.map((row) => ({
        sessionId: row.sid,
        failingEventId: row.failing,
        passingEventId: row.passing,
        note: 'failure and completion reported for same session; surface both, resolve neither'
    }))
}
