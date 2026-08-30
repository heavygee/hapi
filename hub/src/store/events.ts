import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { OverseerSessionIdentity } from '@hapi/protocol'

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
}

export type ListSystemEventsOptions = {
    limit?: number
    beforeId?: number | null
    sessionId?: string | null
    attentionCandidate?: 0 | 1 | null
    eventType?: string | null
    sourceKind?: string | null
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
        severity: row.severity
    }
}

/** Clear session FK refs so DELETE FROM sessions succeeds (events are audit-retained). */
export function detachSessionEvents(db: Database, sessionId: string): number {
    const result = db.prepare(
        'UPDATE overseer_events SET related_session_id = NULL WHERE related_session_id = ?'
    ).run(sessionId)
    return result.changes
}

/** Move overseer event refs when session rows merge (reopen/resume id swap). */
export function repointSessionEvents(db: Database, fromSessionId: string, toSessionId: string): number {
    if (fromSessionId === toSessionId) {
        return 0
    }
    const countRow = db.prepare(
        'SELECT COUNT(*) as count FROM overseer_events WHERE related_session_id = ?'
    ).get(fromSessionId) as { count: number }
    const pending = countRow.count
    if (pending === 0) {
        return 0
    }
    db.prepare(
        'UPDATE overseer_events SET related_session_id = ? WHERE related_session_id = ?'
    ).run(toSessionId, fromSessionId)
    return pending
}

export function insertSystemEvent(db: Database, input: InsertSystemEventInput): StoredSystemEvent | null {
    if (input.idempotencyKey) {
        const existing = db.prepare(
            'SELECT id FROM overseer_events WHERE idempotency_key = ? LIMIT 1'
        ).get(input.idempotencyKey) as { id: number } | undefined
        if (existing) {
            return getSystemEventById(db, existing.id)
        }
    }

    const stmt = db.prepare(`
        INSERT INTO overseer_events (
            ts, source_kind, source_ref, sink_kind, sink_ref,
            event_type, attention_candidate, operator_action_required, risk_detected,
            summary, payload_json, artifact_refs, tags,
            related_session_id, related_event_id, dedupe_key, expires_at,
            provenance, idempotency_key, confidence, severity
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?
        )
    `)

    const result = stmt.run(
        input.ts,
        input.sourceKind,
        input.sourceRef ?? null,
        input.sinkKind ?? null,
        input.sinkRef ?? null,
        input.eventType,
        input.attentionCandidate,
        input.operatorActionRequired ?? 0,
        input.riskDetected ?? 0,
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
        input.severity ?? null
    )

    const id = Number(result.lastInsertRowid)
    return getSystemEventById(db, id)
}

export function deleteSystemEventByIdempotencyKey(db: Database, idempotencyKey: string): boolean {
    const result = db.prepare('DELETE FROM events WHERE idempotency_key = ?').run(idempotencyKey)
    return result.changes > 0
}

export function findSystemEventByIdempotencyKey(db: Database, idempotencyKey: string): StoredSystemEvent | null {
    const row = db.prepare(
        'SELECT * FROM events WHERE idempotency_key = ? LIMIT 1'
    ).get(idempotencyKey) as SystemEventRow | undefined
    return row ? mapRow(row) : null
}

export function getSystemEventById(db: Database, id: number): StoredSystemEvent | null {
    const row = db.prepare('SELECT * FROM overseer_events WHERE id = ?').get(id) as SystemEventRow | undefined
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
        db.prepare('UPDATE overseer_events SET payload_json = ?, summary = ? WHERE id = ?').run(payloadJson, summary, id)
    } else {
        db.prepare('UPDATE overseer_events SET payload_json = ? WHERE id = ?').run(payloadJson, id)
    }
    return getSystemEventById(db, id)
}

export function listSystemEvents(db: Database, options: ListSystemEventsOptions = {}): StoredSystemEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const clauses: string[] = []
    const params: Array<string | number> = []

    if (options.sessionId) {
        clauses.push('related_session_id = ?')
        params.push(options.sessionId)
    }
    if (options.attentionCandidate !== undefined && options.attentionCandidate !== null) {
        clauses.push('attention_candidate = ?')
        params.push(options.attentionCandidate)
    }
    if (options.eventType) {
        clauses.push('event_type = ?')
        params.push(options.eventType)
    }
    if (options.sourceKind) {
        clauses.push('source_kind = ?')
        params.push(options.sourceKind)
    }
    if (options.beforeId) {
        clauses.push('id < ?')
        params.push(options.beforeId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(
        `SELECT * FROM overseer_events ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params, limit) as SystemEventRow[]

    return rows.map(mapRow)
}

export function getSystemEventByIdempotencyKey(db: Database, idempotencyKey: string): StoredSystemEvent | null {
    const row = db.prepare(
        'SELECT * FROM overseer_events WHERE idempotency_key = ? LIMIT 1'
    ).get(idempotencyKey) as SystemEventRow | undefined
    return row ? mapRow(row) : null
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
        clauses.push('related_session_id = ?')
        params.push(options.sessionId)
    }
    if (options.attentionCandidate !== undefined && options.attentionCandidate !== null) {
        clauses.push('attention_candidate = ?')
        params.push(options.attentionCandidate)
    }
    if (options.eventType) {
        clauses.push('event_type = ?')
        params.push(options.eventType)
    }
    if (options.sourceKind) {
        clauses.push('source_kind = ?')
        params.push(options.sourceKind)
    }
    if (options.severityMin !== undefined && options.severityMin !== null) {
        clauses.push('severity >= ?')
        params.push(options.severityMin)
    }
    if (options.sinceTs !== undefined && options.sinceTs !== null) {
        clauses.push('ts >= ?')
        params.push(options.sinceTs)
    }
    if (options.untilTs !== undefined && options.untilTs !== null) {
        clauses.push('ts <= ?')
        params.push(options.untilTs)
    }
    if (options.project) {
        // Denormalized session.project lives in payload_json (#22).
        clauses.push("json_extract(payload_json, '$.session.project') = ?")
        params.push(options.project)
    }
    if (options.beforeId) {
        clauses.push('id < ?')
        params.push(options.beforeId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(
        `SELECT * FROM overseer_events ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params, limit) as SystemEventRow[]

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
        SELECT e.* FROM overseer_events e
        JOIN (
            SELECT related_session_id AS sid, MAX(id) AS max_id
            FROM overseer_events
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
        INSERT INTO overseer_event_links (id, from_event_id, to_event_id, relation_type, created_at, metadata_json)
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
    const row = db.prepare('SELECT COUNT(*) AS count FROM overseer_events').get() as { count: number }
    return row.count
}

function tableExists(db: Database, name: string): boolean {
    const row = db.prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    ).get(name) as { ok: number } | undefined
    return Boolean(row)
}

function tableColumns(db: Database, name: string): Set<string> {
    if (!tableExists(db, name)) return new Set()
    const rows = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>
    return new Set(rows.map((row) => row.name))
}

/**
 * Upstream work-graph (#1467 / #1374) owns the `events` / `event_links` names.
 * Soup Overseer previously used those names with an incompatible INTEGER-PK shape.
 * Rehome any leftover Overseer-shaped `events` table before work-graph DDL runs.
 */
export function rehomeOverseerEventsAwayFromWorkGraphCollision(db: Database): void {
    if (tableExists(db, 'overseer_events')) {
        return
    }
    const cols = tableColumns(db, 'events')
    if (!cols.has('attention_candidate')) {
        return
    }

    // Drop FTS/triggers bound to the old name before RENAME (SQLite FTS is picky).
    db.exec(`
        DROP TRIGGER IF EXISTS events_fts_insert;
        DROP TRIGGER IF EXISTS events_fts_delete;
        DROP TRIGGER IF EXISTS events_fts_update;
        DROP TRIGGER IF EXISTS overseer_events_fts_insert;
        DROP TRIGGER IF EXISTS overseer_events_fts_delete;
        DROP TRIGGER IF EXISTS overseer_events_fts_update;
        DROP TABLE IF EXISTS events_fts;
        DROP TABLE IF EXISTS overseer_events_fts;
    `)

    db.exec('ALTER TABLE events RENAME TO overseer_events')

    if (tableExists(db, 'event_links') && !tableExists(db, 'overseer_event_links')) {
        const linkCols = tableColumns(db, 'event_links')
        // Work-graph links carry namespace; Overseer links do not.
        if (!linkCols.has('namespace')) {
            db.exec('ALTER TABLE event_links RENAME TO overseer_event_links')
        }
    }
}

/**
 * Idempotent Overseer events DDL — runs on every Store init, NOT gated on SCHEMA_VERSION.
 * Additive Overseer tables must never own a version step (soup composability).
 * Table names are `overseer_events*` so they do not collide with upstream work-graph `events`.
 */
export function ensureOverseerEventsSchema(db: Database): void {
    rehomeOverseerEventsAwayFromWorkGraphCollision(db)
    db.exec(`
        CREATE TABLE IF NOT EXISTS overseer_events (
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
            related_event_id INTEGER REFERENCES overseer_events(id),
            dedupe_key TEXT,
            expires_at INTEGER,
            provenance TEXT,
            idempotency_key TEXT,
            confidence REAL,
            severity INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_overseer_events_session_ts ON overseer_events(related_session_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_overseer_events_type_ts ON overseer_events(event_type, ts DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_overseer_events_dedupe_key ON overseer_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_overseer_events_idempotency_key ON overseer_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

        CREATE TABLE IF NOT EXISTS overseer_event_links (
            id TEXT PRIMARY KEY,
            from_event_id INTEGER NOT NULL REFERENCES overseer_events(id),
            to_event_id INTEGER NOT NULL REFERENCES overseer_events(id),
            relation_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_overseer_event_links_from ON overseer_event_links(from_event_id);
        CREATE INDEX IF NOT EXISTS idx_overseer_event_links_to ON overseer_event_links(to_event_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS overseer_events_fts USING fts5(
            summary,
            tags,
            payload_json,
            tokenize = 'porter'
        );
    `)

    // Recreate triggers every boot so a live DB with dropped/broken triggers self-heals.
    db.exec(`
        DROP TRIGGER IF EXISTS overseer_events_fts_insert;
        DROP TRIGGER IF EXISTS overseer_events_fts_delete;
        DROP TRIGGER IF EXISTS overseer_events_fts_update;

        CREATE TRIGGER overseer_events_fts_insert AFTER INSERT ON overseer_events BEGIN
            INSERT INTO overseer_events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;

        CREATE TRIGGER overseer_events_fts_delete AFTER DELETE ON overseer_events BEGIN
            DELETE FROM overseer_events_fts WHERE rowid = old.id;
        END;

        CREATE TRIGGER overseer_events_fts_update AFTER UPDATE ON overseer_events BEGIN
            DELETE FROM overseer_events_fts WHERE rowid = old.id;
            INSERT INTO overseer_events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;
    `)
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
        DROP TRIGGER IF EXISTS overseer_events_fts_delete;
        DROP TRIGGER IF EXISTS overseer_events_fts_update;
        DROP TRIGGER IF EXISTS overseer_events_fts_insert;
        DROP TABLE IF EXISTS overseer_events_fts;
        DROP INDEX IF EXISTS idx_overseer_events_idempotency_key;
        DROP INDEX IF EXISTS idx_overseer_event_links_to;
        DROP INDEX IF EXISTS idx_overseer_event_links_from;
        DROP TABLE IF EXISTS overseer_event_links;
        DROP INDEX IF EXISTS idx_overseer_events_dedupe_key;
        DROP INDEX IF EXISTS idx_overseer_events_type_ts;
        DROP INDEX IF EXISTS idx_overseer_events_session_ts;
        DROP TABLE IF EXISTS overseer_events;
        DROP TABLE IF EXISTS deleted_sessions;
    `)
}

/** @deprecated use dropOverseerEventsSchema — events no longer own SCHEMA_VERSION */
export function downgradeEventsSchemaV11ToV10(db: Database): void {
    dropOverseerEventsSchema(db)
}
