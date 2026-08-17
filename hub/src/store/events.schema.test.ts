import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ensureOverseerEventsSchema } from './events'

describe('ensureOverseerEventsSchema', () => {
    it('migrates legacy events table that predates namespace column', () => {
        const db = new Database(':memory:')
        db.exec(`
            CREATE TABLE events (
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
                related_session_id TEXT,
                related_event_id INTEGER,
                dedupe_key TEXT,
                expires_at INTEGER,
                provenance TEXT,
                idempotency_key TEXT,
                confidence REAL,
                severity INTEGER
            );
            CREATE UNIQUE INDEX idx_events_dedupe_key ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default'
            );
            INSERT INTO sessions (id, namespace) VALUES ('legacy-foreign-sess', 'other-ns');
            INSERT INTO events (
                ts, source_kind, event_type, attention_candidate, summary,
                related_session_id, dedupe_key, provenance
            ) VALUES (
                1, 'channel', 'blocked', 1, 'legacy foreign event',
                'legacy-foreign-sess', 'contrib:tiann/hapi#1:blocked', 'test'
            );
        `)

        expect(() => ensureOverseerEventsSchema(db)).not.toThrow()

        const row = db.prepare(
            `SELECT namespace FROM events WHERE dedupe_key = 'contrib:tiann/hapi#1:blocked'`
        ).get() as { namespace: string }
        expect(row.namespace).toBe('other-ns')

        const columns = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>
        expect(columns.some((column) => column.name === 'namespace')).toBe(true)

        const index = db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_namespace_dedupe_key'`
        ).get() as { name: string } | null
        expect(index?.name).toBe('idx_events_namespace_dedupe_key')
    })
})
