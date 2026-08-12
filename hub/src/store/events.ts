import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import {
    defaultPrincipalForSourceKind,
    EventPrincipalOwnershipError,
    serializeEventPrincipal,
    type EventPrincipal,
    type OverseerSessionIdentity
} from '@hapi/protocol'

export { EventPrincipalOwnershipError }
export type { EventPrincipal }

export type InsertSystemEventInput = {
    ts: number
    sourceKind: 'worker' | 'overseer' | 'operator' | 'system' | 'channel'
    sourceRef?: string | null
    sinkKind?: string | null
    sinkRef?: string | null
    eventType: string
    attentionCandidate: 0 | 1
    operatorActionRequired?: 0 | 1
    riskDetected?: 0 | 1
    summary: string
    payloadJson?: string | null
    artifactRefs?: string | null
    tags?: string | null
    relatedSessionId?: string | null
    relatedEventId?: number | null
    dedupeKey?: string | null
    expiresAt?: number | null
    provenance?: string | null
    idempotencyKey?: string | null
    confidence?: number | null
    severity?: number | null
    /** Tenancy scope. Defaults to `default` when omitted. */
    namespace?: string | null
    /**
     * Structured principal. When omitted, derived from sourceKind with a
     * resolvable human owner (single-op fork default). Non-human without
     * owner is refused (RFC kill criterion).
     */
    principal?: EventPrincipal | null
}

export type StoredSystemEvent = {
    id: number
    ts: number
    sourceKind: string
    sourceRef: string | null
    sinkKind: string | null
    sinkRef: string | null
    eventType: string
    attentionCandidate: number
    operatorActionRequired: number
    riskDetected: number
    summary: string
    payloadJson: string | null
    artifactRefs: string | null
    tags: string | null
    relatedSessionId: string | null
    relatedEventId: number | null
    dedupeKey: string | null
    expiresAt: number | null
    provenance: string | null
    idempotencyKey: string | null
    confidence: number | null
    severity: number | null
    namespace: string | null
    principalJson: string | null
}

export type ListSystemEventsOptions = {
    limit?: number
    beforeId?: number | null
    sessionId?: string | null
    attentionCandidate?: 0 | 1 | null
    eventType?: string | null
    /** When set, only rows in this namespace (NULL legacy rows match `default`). */
    namespace?: string | null
}

/** Extended read-only filter set for the Overseer `query_events` tool. */
export type QueryEventsOptions = ListSystemEventsOptions & {
    /** Match denormalized `payload_json.session.project` (#22). */
    project?: string | null
    sourceKind?: string | null
    /** Inclusive lower bound on severity (1-5). */
    severityMin?: number | null
    /** Inclusive lower bound on `ts` (ms epoch). */
    sinceTs?: number | null
    /** Inclusive upper bound on `ts` (ms epoch). */
    untilTs?: number | null
}

type SystemEventRow = {
    id: number
    ts: number
    source_kind: string
    source_ref: string | null
    sink_kind: string | null
    sink_ref: string | null
    event_type: string
    attention_candidate: number
    operator_action_required: number
    risk_detected: number
    summary: string
    payload_json: string | null
    artifact_refs: string | null
    tags: string | null
    related_session_id: string | null
    related_event_id: number | null
    dedupe_key: string | null
    expires_at: number | null
    provenance: string | null
    idempotency_key: string | null
    confidence: number | null
    severity: number | null
    namespace: string | null
    principal_json: string | null
}

function mapRow(row: SystemEventRow): StoredSystemEvent {
    return {
        id: row.id,
        ts: row.ts,
        sourceKind: row.source_kind,
        sourceRef: row.source_ref,
        sinkKind: row.sink_kind,
        sinkRef: row.sink_ref,
        eventType: row.event_type,
        attentionCandidate: row.attention_candidate,
        operatorActionRequired: row.operator_action_required,
        riskDetected: row.risk_detected,
        summary: row.summary,
        payloadJson: row.payload_json,
        artifactRefs: row.artifact_refs,
        tags: row.tags,
        relatedSessionId: row.related_session_id,
        relatedEventId: row.related_event_id,
        dedupeKey: row.dedupe_key,
        expiresAt: row.expires_at,
        provenance: row.provenance,
        idempotencyKey: row.idempotency_key,
        confidence: row.confidence,
        severity: row.severity,
        namespace: row.namespace,
        principalJson: row.principal_json
    }
}

/**
 * Attention triad lives in fork-local `event_attention` (RFC B7 / A2A #1332).
 * Reads COALESCE from the sidecar; absent row = all zeros.
 * Legacy `events.attention_*` columns remain but are no longer written for new rows.
 */
const EVENT_SELECT_WITH_ATTENTION = `
    e.id, e.ts, e.source_kind, e.source_ref, e.sink_kind, e.sink_ref, e.event_type,
    COALESCE(a.attention_candidate, 0) AS attention_candidate,
    COALESCE(a.operator_action_required, 0) AS operator_action_required,
    COALESCE(a.risk_detected, 0) AS risk_detected,
    e.summary, e.payload_json, e.artifact_refs, e.tags,
    e.related_session_id, e.related_event_id, e.dedupe_key, e.expires_at,
    e.provenance, e.idempotency_key, e.confidence, e.severity,
    e.namespace, e.principal_json
`

const EVENT_FROM_WITH_ATTENTION = `
    FROM events e
    LEFT JOIN event_attention a ON a.event_id = e.id
`

/** Persist salience flags to the sidecar. Zero triad deletes the sparse row. */
export function upsertEventAttention(
    db: Database,
    eventId: number,
    flags: { attentionCandidate: number; operatorActionRequired: number; riskDetected: number }
): void {
    const attn = flags.attentionCandidate ? 1 : 0
    const oar = flags.operatorActionRequired ? 1 : 0
    const risk = flags.riskDetected ? 1 : 0
    if (attn === 0 && oar === 0 && risk === 0) {
        db.prepare('DELETE FROM event_attention WHERE event_id = ?').run(eventId)
        return
    }
    db.prepare(`
        INSERT INTO event_attention (
            event_id, attention_candidate, operator_action_required, risk_detected
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
            attention_candidate = excluded.attention_candidate,
            operator_action_required = excluded.operator_action_required,
            risk_detected = excluded.risk_detected
    `).run(eventId, attn, oar, risk)
}

/**
 * Sparse backfill from legacy events columns → sidecar.
 * Idempotent (INSERT OR IGNORE). Absent sidecar row means all-zero.
 */
export function backfillEventAttentionFromEvents(db: Database): number {
    const result = db.prepare(`
        INSERT OR IGNORE INTO event_attention (
            event_id, attention_candidate, operator_action_required, risk_detected
        )
        SELECT id, attention_candidate, operator_action_required, risk_detected
        FROM events
        WHERE attention_candidate <> 0
           OR operator_action_required <> 0
           OR risk_detected <> 0
    `).run()
    return result.changes
}

/**
 * Every non-zero legacy events-column triad must match the sidecar.
 * After we stop writing the columns, new salience-only-in-sidecar rows are
 * excluded (events flags stay 0) — so this stays valid across boots.
 */
export function verifyEventAttentionParity(db: Database): {
    mismatches: number
    events: { attention: number; operatorAction: number; risk: number }
    sidecar: { attention: number; operatorAction: number; risk: number }
} {
    const mismatches = (db.prepare(`
        SELECT COUNT(*) AS c FROM events e
        LEFT JOIN event_attention a ON a.event_id = e.id
        WHERE (e.attention_candidate <> 0
            OR e.operator_action_required <> 0
            OR e.risk_detected <> 0)
          AND (
            a.event_id IS NULL
            OR a.attention_candidate != e.attention_candidate
            OR a.operator_action_required != e.operator_action_required
            OR a.risk_detected != e.risk_detected
          )
    `).get() as { c: number }).c

    const eSums = db.prepare(`
        SELECT
            COALESCE(SUM(attention_candidate), 0) AS attention,
            COALESCE(SUM(operator_action_required), 0) AS operatorAction,
            COALESCE(SUM(risk_detected), 0) AS risk
        FROM events
    `).get() as { attention: number; operatorAction: number; risk: number }

    const aSums = db.prepare(`
        SELECT
            COALESCE(SUM(attention_candidate), 0) AS attention,
            COALESCE(SUM(operator_action_required), 0) AS operatorAction,
            COALESCE(SUM(risk_detected), 0) AS risk
        FROM event_attention
    `).get() as { attention: number; operatorAction: number; risk: number }

    return { mismatches, events: eSums, sidecar: aSums }
}

/** Clear session FK refs so DELETE FROM sessions succeeds (events are audit-retained). */
export function detachSessionEvents(db: Database, sessionId: string): number {
    const result = db.prepare(
        'UPDATE events SET related_session_id = NULL WHERE related_session_id = ?'
    ).run(sessionId)
    return result.changes
}

/** Move overseer event refs when session rows merge (reopen/resume id swap). */
export function repointSessionEvents(db: Database, fromSessionId: string, toSessionId: string): number {
    if (fromSessionId === toSessionId) {
        return 0
    }
    const countRow = db.prepare(
        'SELECT COUNT(*) as count FROM events WHERE related_session_id = ?'
    ).get(fromSessionId) as { count: number }
    const pending = countRow.count
    if (pending === 0) {
        return 0
    }
    db.prepare(
        'UPDATE events SET related_session_id = ? WHERE related_session_id = ?'
    ).run(toSessionId, fromSessionId)
    return pending
}

export function insertSystemEvent(db: Database, input: InsertSystemEventInput): StoredSystemEvent | null {
    if (input.idempotencyKey) {
        const existing = db.prepare(
            'SELECT id FROM events WHERE idempotency_key = ? LIMIT 1'
        ).get(input.idempotencyKey) as { id: number } | undefined
        if (existing) {
            return getSystemEventById(db, existing.id)
        }
    }

    const attentionCandidate = input.attentionCandidate ? 1 : 0
    const operatorActionRequired = input.operatorActionRequired ? 1 : 0
    const riskDetected = input.riskDetected ? 1 : 0

    const principal = input.principal
        ?? defaultPrincipalForSourceKind(input.sourceKind, input.sourceRef)
    let principalJson: string
    try {
        principalJson = serializeEventPrincipal(principal)
    } catch (error) {
        if (error instanceof EventPrincipalOwnershipError) throw error
        throw error
    }

    const namespace = (input.namespace?.trim() || 'default')

    // Legacy events.* attention columns: stop writing (always 0). Sidecar is SoT.
    const stmt = db.prepare(`
        INSERT INTO events (
            ts, source_kind, source_ref, sink_kind, sink_ref,
            event_type, attention_candidate, operator_action_required, risk_detected,
            summary, payload_json, artifact_refs, tags,
            related_session_id, related_event_id, dedupe_key, expires_at,
            provenance, idempotency_key, confidence, severity,
            namespace, principal_json
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?
        )
    `)

    const result = stmt.run(
        input.ts,
        input.sourceKind,
        input.sourceRef ?? null,
        input.sinkKind ?? null,
        input.sinkRef ?? null,
        input.eventType,
        0,
        0,
        0,
        input.summary,
        input.payloadJson ?? null,
        input.artifactRefs ?? null,
        input.tags ?? null,
        input.relatedSessionId ?? null,
        input.relatedEventId ?? null,
        input.dedupeKey ?? null,
        input.expiresAt ?? null,
        input.provenance ?? null,
        input.idempotencyKey ?? null,
        input.confidence ?? null,
        input.severity ?? null,
        namespace,
        principalJson
    )

    const id = Number(result.lastInsertRowid)
    upsertEventAttention(db, id, {
        attentionCandidate,
        operatorActionRequired,
        riskDetected
    })
    return getSystemEventById(db, id)
}

export function getSystemEventById(db: Database, id: number): StoredSystemEvent | null {
    const row = db.prepare(`
        SELECT ${EVENT_SELECT_WITH_ATTENTION}
        ${EVENT_FROM_WITH_ATTENTION}
        WHERE e.id = ?
    `).get(id) as SystemEventRow | undefined
    return row ? mapRow(row) : null
}

/** Patch payload (and optionally summary) on an existing audit-retained event row. */
export function updateSystemEventPayload(
    db: Database,
    id: number,
    payloadJson: string,
    summary?: string
): StoredSystemEvent | null {
    if (summary !== undefined) {
        db.prepare('UPDATE events SET payload_json = ?, summary = ? WHERE id = ?').run(payloadJson, summary, id)
    } else {
        db.prepare('UPDATE events SET payload_json = ? WHERE id = ?').run(payloadJson, id)
    }
    return getSystemEventById(db, id)
}

export function listSystemEvents(db: Database, options: ListSystemEventsOptions = {}): StoredSystemEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const clauses: string[] = []
    const params: Array<string | number> = []

    if (options.sessionId) {
        clauses.push('e.related_session_id = ?')
        params.push(options.sessionId)
    }
    if (options.attentionCandidate !== undefined && options.attentionCandidate !== null) {
        clauses.push('COALESCE(a.attention_candidate, 0) = ?')
        params.push(options.attentionCandidate)
    }
    if (options.eventType) {
        clauses.push('e.event_type = ?')
        params.push(options.eventType)
    }
    if (options.namespace) {
        clauses.push("COALESCE(e.namespace, 'default') = ?")
        params.push(options.namespace)
    }
    if (options.beforeId) {
        clauses.push('e.id < ?')
        params.push(options.beforeId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
        SELECT ${EVENT_SELECT_WITH_ATTENTION}
        ${EVENT_FROM_WITH_ATTENTION}
        ${where}
        ORDER BY e.id DESC
        LIMIT ?
    `).all(...params, limit) as SystemEventRow[]

    return rows.map(mapRow)
}

/**
 * Read-only extended event query for the Overseer. Additive over
 * {@link listSystemEvents}; the existing route/promotion paths are untouched.
 */
export function queryEvents(db: Database, options: QueryEventsOptions = {}): StoredSystemEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const clauses: string[] = []
    const params: Array<string | number> = []

    if (options.sessionId) {
        clauses.push('e.related_session_id = ?')
        params.push(options.sessionId)
    }
    if (options.attentionCandidate !== undefined && options.attentionCandidate !== null) {
        clauses.push('COALESCE(a.attention_candidate, 0) = ?')
        params.push(options.attentionCandidate)
    }
    if (options.eventType) {
        clauses.push('e.event_type = ?')
        params.push(options.eventType)
    }
    if (options.sourceKind) {
        clauses.push('e.source_kind = ?')
        params.push(options.sourceKind)
    }
    if (options.severityMin !== undefined && options.severityMin !== null) {
        clauses.push('e.severity >= ?')
        params.push(options.severityMin)
    }
    if (options.sinceTs !== undefined && options.sinceTs !== null) {
        clauses.push('e.ts >= ?')
        params.push(options.sinceTs)
    }
    if (options.untilTs !== undefined && options.untilTs !== null) {
        clauses.push('e.ts <= ?')
        params.push(options.untilTs)
    }
    if (options.project) {
        // Denormalized session.project lives in payload_json (#22).
        clauses.push("json_extract(e.payload_json, '$.session.project') = ?")
        params.push(options.project)
    }
    if (options.namespace) {
        clauses.push("COALESCE(e.namespace, 'default') = ?")
        params.push(options.namespace)
    }
    if (options.beforeId) {
        clauses.push('e.id < ?')
        params.push(options.beforeId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
        SELECT ${EVENT_SELECT_WITH_ATTENTION}
        ${EVENT_FROM_WITH_ATTENTION}
        ${where}
        ORDER BY e.id DESC
        LIMIT ?
    `).all(...params, limit) as SystemEventRow[]

    return rows.map(mapRow)
}

/**
 * Latest status-bearing worker event per session — the substrate for the
 * cold-open-loops lens. "Status-bearing" = the notify-derived types that either
 * open a loop (needs_decision/needs_review/blocked/failed/stale) or close it
 * (completed); `progress` is intentionally excluded so a progress ping does not
 * mask an unanswered decision. The caller decides open vs closed by inspecting
 * the returned event's type. Bounded and index-friendly (one row per session).
 */
export function queryLatestWorkerStatusPerSession(db: Database, limit = 500): StoredSystemEvent[] {
    const cap = Math.min(Math.max(limit, 1), 2000)
    const rows = db.prepare(`
        SELECT ${EVENT_SELECT_WITH_ATTENTION}
        ${EVENT_FROM_WITH_ATTENTION}
        JOIN (
            SELECT related_session_id AS sid, MAX(id) AS max_id
            FROM events
            WHERE source_kind = 'worker'
              AND related_session_id IS NOT NULL
              AND event_type IN (
                  'needs_decision', 'needs_review', 'blocked', 'failed', 'stale', 'completed'
              )
            GROUP BY related_session_id
        ) latest ON e.id = latest.max_id
        ORDER BY e.ts ASC
        LIMIT ?
    `).all(cap) as SystemEventRow[]
    return rows.map(mapRow)
}

export function insertEventLink(
    db: Database,
    input: {
        fromEventId: number
        toEventId: number
        relationType: string
        createdAt: number
        metadataJson?: string | null
    }
): string {
    const id = randomUUID()
    db.prepare(`
        INSERT INTO event_links (id, from_event_id, to_event_id, relation_type, created_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        id,
        input.fromEventId,
        input.toEventId,
        input.relationType,
        input.createdAt,
        input.metadataJson ?? null
    )
    return id
}

export function countSystemEvents(db: Database): number {
    const row = db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }
    return row.count
}

/**
 * Idempotent Overseer events DDL — runs on every Store init, NOT gated on SCHEMA_VERSION.
 * Additive Overseer tables must never own a version step (soup composability).
 */
export function ensureOverseerEventsSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            ts INTEGER NOT NULL,
            source_kind TEXT NOT NULL,
            source_ref TEXT,
            sink_kind TEXT,
            sink_ref TEXT,
            event_type TEXT NOT NULL,
            attention_candidate INTEGER NOT NULL DEFAULT 0,
            operator_action_required INTEGER NOT NULL DEFAULT 0,
            risk_detected INTEGER NOT NULL DEFAULT 0,
            summary TEXT NOT NULL,
            payload_json TEXT,
            artifact_refs TEXT,
            tags TEXT,
            related_session_id TEXT REFERENCES sessions(id),
            related_event_id INTEGER REFERENCES events(id),
            dedupe_key TEXT,
            expires_at INTEGER,
            provenance TEXT,
            idempotency_key TEXT,
            confidence REAL,
            severity INTEGER,
            namespace TEXT,
            principal_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(related_session_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(event_type, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_events_namespace_ts ON events(namespace, ts DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe_key ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency_key ON events(idempotency_key) WHERE idempotency_key IS NOT NULL;

        CREATE TABLE IF NOT EXISTS event_links (
            id TEXT PRIMARY KEY,
            from_event_id INTEGER NOT NULL REFERENCES events(id),
            to_event_id INTEGER NOT NULL REFERENCES events(id),
            relation_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_event_links_from ON event_links(from_event_id);
        CREATE INDEX IF NOT EXISTS idx_event_links_to ON event_links(to_event_id);

        CREATE TABLE IF NOT EXISTS event_attention (
            event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
            attention_candidate INTEGER NOT NULL DEFAULT 0,
            operator_action_required INTEGER NOT NULL DEFAULT 0,
            risk_detected INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_event_attention_attn
            ON event_attention(attention_candidate) WHERE attention_candidate <> 0;
        CREATE INDEX IF NOT EXISTS idx_event_attention_oar
            ON event_attention(operator_action_required) WHERE operator_action_required <> 0;

        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
            summary,
            tags,
            payload_json,
            tokenize = 'porter'
        );
    `)

    ensureEventsTenancyColumns(db)

    // Recreate triggers every boot so a live DB with dropped/broken triggers self-heals.
    db.exec(`
        DROP TRIGGER IF EXISTS events_fts_insert;
        DROP TRIGGER IF EXISTS events_fts_delete;
        DROP TRIGGER IF EXISTS events_fts_update;

        CREATE TRIGGER events_fts_insert AFTER INSERT ON events BEGIN
            INSERT INTO events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;

        CREATE TRIGGER events_fts_delete AFTER DELETE ON events BEGIN
            DELETE FROM events_fts WHERE rowid = old.id;
        END;

        CREATE TRIGGER events_fts_update AFTER UPDATE ON events BEGIN
            DELETE FROM events_fts WHERE rowid = old.id;
            INSERT INTO events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;
    `)

    const backfilled = backfillEventAttentionFromEvents(db)
    const parity = verifyEventAttentionParity(db)
    console.info('[Overseer][Events] event_attention parity', {
        backfilled,
        mismatches: parity.mismatches,
        events: parity.events,
        sidecar: parity.sidecar
    })
    if (parity.mismatches > 0) {
        console.warn('[Overseer][Events] event_attention parity mismatch', {
            count: parity.mismatches
        })
    }
}

/** Idempotent ADD COLUMN for tenancy fields (SQLite has no ADD COLUMN IF NOT EXISTS). */
function ensureEventsTenancyColumns(db: Database): void {
    const existing = new Set(
        (db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map((c) => c.name)
    )
    if (!existing.has('namespace')) {
        db.exec('ALTER TABLE events ADD COLUMN namespace TEXT')
    }
    if (!existing.has('principal_json')) {
        db.exec('ALTER TABLE events ADD COLUMN principal_json TEXT')
    }
}

/** @deprecated use ensureOverseerEventsSchema */
export const createEventsSchemaV11 = ensureOverseerEventsSchema

export function ensureDeletedSessionsSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS deleted_sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            name TEXT,
            project TEXT,
            flavor TEXT,
            deleted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_deleted_sessions_deleted_at
            ON deleted_sessions(deleted_at DESC);
    `)
}

export function tombstoneDeletedSession(
    db: Database,
    identity: OverseerSessionIdentity,
    deletedAt: number
): void {
    db.prepare(`
        INSERT INTO deleted_sessions (id, tag, name, project, flavor, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            tag = excluded.tag,
            name = excluded.name,
            project = excluded.project,
            flavor = excluded.flavor,
            deleted_at = excluded.deleted_at
    `).run(
        identity.id,
        identity.tag,
        identity.name,
        identity.project,
        identity.flavor,
        deletedAt
    )
}

/** Drop Overseer events tables (db-prep / layer removal). Does NOT change user_version. */
export function dropOverseerEventsSchema(db: Database): void {
    db.exec(`
        DROP TRIGGER IF EXISTS events_fts_delete;
        DROP TRIGGER IF EXISTS events_fts_update;
        DROP TRIGGER IF EXISTS events_fts_insert;
        DROP TABLE IF EXISTS events_fts;
        DROP INDEX IF EXISTS idx_event_attention_oar;
        DROP INDEX IF EXISTS idx_event_attention_attn;
        DROP TABLE IF EXISTS event_attention;
        DROP INDEX IF EXISTS idx_events_idempotency_key;
        DROP INDEX IF EXISTS idx_event_links_to;
        DROP INDEX IF EXISTS idx_event_links_from;
        DROP TABLE IF EXISTS event_links;
        DROP INDEX IF EXISTS idx_events_dedupe_key;
        DROP INDEX IF EXISTS idx_events_namespace_ts;
        DROP INDEX IF EXISTS idx_events_type_ts;
        DROP INDEX IF EXISTS idx_events_session_ts;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS deleted_sessions;
    `)
}

/** @deprecated use dropOverseerEventsSchema — events no longer own SCHEMA_VERSION */
export function downgradeEventsSchemaV11ToV10(db: Database): void {
    dropOverseerEventsSchema(db)
}
