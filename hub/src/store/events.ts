import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

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

export function insertSystemEvent(db: Database, input: InsertSystemEventInput): StoredSystemEvent | null {
    if (input.idempotencyKey) {
        const existing = db.prepare(
            'SELECT id FROM events WHERE idempotency_key = ? LIMIT 1'
        ).get(input.idempotencyKey) as { id: number } | undefined
        if (existing) {
            return getSystemEventById(db, existing.id)
        }
    }

    const stmt = db.prepare(`
        INSERT INTO events (
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

export function getSystemEventById(db: Database, id: number): StoredSystemEvent | null {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as SystemEventRow | undefined
    return row ? mapRow(row) : null
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
    if (options.beforeId) {
        clauses.push('id < ?')
        params.push(options.beforeId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(
        `SELECT * FROM events ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params, limit) as SystemEventRow[]

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

/** Reverse migration helper for v11 -> v10 (used in tests + fork db-prep). */
export function downgradeEventsSchemaV11ToV10(db: Database): void {
    db.exec(`
        DROP TRIGGER IF EXISTS events_fts_delete;
        DROP TRIGGER IF EXISTS events_fts_update;
        DROP TRIGGER IF EXISTS events_fts_insert;
        DROP TABLE IF EXISTS events_fts;
        DROP INDEX IF EXISTS idx_events_idempotency_key;
        DROP INDEX IF EXISTS idx_event_links_to;
        DROP INDEX IF EXISTS idx_event_links_from;
        DROP TABLE IF EXISTS event_links;
        DROP INDEX IF EXISTS idx_events_dedupe_key;
        DROP INDEX IF EXISTS idx_events_type_ts;
        DROP INDEX IF EXISTS idx_events_session_ts;
        DROP TABLE IF EXISTS events;
        PRAGMA user_version = 10;
    `)
}

export function createEventsSchemaV11(db: Database): void {
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
            severity INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(related_session_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(event_type, ts DESC);
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

        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
            summary,
            tags,
            payload_json,
            tokenize = 'porter'
        );

        CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
            INSERT INTO events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
            INSERT INTO events_fts(events_fts, rowid, summary, tags, payload_json)
            VALUES ('delete', old.id, old.summary, COALESCE(old.tags, ''), COALESCE(old.payload_json, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE ON events BEGIN
            INSERT INTO events_fts(events_fts, rowid, summary, tags, payload_json)
            VALUES ('delete', old.id, old.summary, COALESCE(old.tags, ''), COALESCE(old.payload_json, ''));
            INSERT INTO events_fts(rowid, summary, tags, payload_json)
            VALUES (new.id, new.summary, COALESCE(new.tags, ''), COALESCE(new.payload_json, ''));
        END;
    `)
}
