import { describe, expect, it } from 'bun:test'
import { Store } from './index'
import { dropOverseerEventsSchema, ensureOverseerEventsSchema, repointSessionEvents } from './events'
import { deleteSession } from './sessions'
import { applySoupV10ToV11Migration } from './schemaV11Soup'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Overseer events schema (init-gated, not SCHEMA_VERSION)', () => {
    it('fresh DB has events, event_links, and events_fts after Store init', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name IN ('events', 'event_links', 'events_fts')"
        ).all() as Array<{ name: string }>
        const names = new Set(tables.map((row) => row.name))
        expect(names.has('events')).toBe(true)
        expect(names.has('event_links')).toBe(true)
        expect(names.has('events_fts')).toBe(true)
    })

    it('v11 DB stamped without events self-heals on Store open (incident regression)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-incident-v11-no-events-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV10Schema(db)
            applySoupV10ToV11Migration(db)
            db.exec('PRAGMA user_version = 11')
            db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                     VALUES ('s1', 'default', 1000, 1000, 0)`)
            db.close()

            store = new Store(dbPath)
            const event = store.events.insert({
                ts: 2000,
                sourceKind: 'worker',
                sourceRef: 'test-agent',
                eventType: 'completed',
                attentionCandidate: 0,
                summary: 'Self-healed after v11 stamp',
                relatedSessionId: 's1',
                provenance: 'test'
            })
            expect(event?.summary).toBe('Self-healed after v11 stamp')
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('V10 DB gets events on Store open without running v11 migration step', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v10-events-init-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV10Schema(db)
            db.exec('PRAGMA user_version = 10')
            db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                     VALUES ('s1', 'default', 1000, 1000, 0)`)
            db.close()

            store = new Store(dbPath)
            const event = store.events.insert({
                ts: 2000,
                sourceKind: 'worker',
                sourceRef: 'test-agent',
                eventType: 'completed',
                attentionCandidate: 0,
                summary: 'Init-gated event',
                relatedSessionId: 's1',
                provenance: 'test'
            })
            expect(event?.summary).toBe('Init-gated event')
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('dropOverseerEventsSchema removes events tables without changing user_version', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        db.exec('PRAGMA user_version = 11')
        dropOverseerEventsSchema(db)
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(11)
        const events = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
        ).get()
        expect(events).toBeNull()
    })

    it('events_fts delete and update triggers use content-storing form', () => {
        const db = new Database(':memory:')
        createV10Schema(db)
        ensureOverseerEventsSchema(db)
        db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                 VALUES ('s1', 'default', 1000, 1000, 0)`)
        db.exec(`INSERT INTO events (ts, source_kind, event_type, attention_candidate, summary, related_session_id)
                 VALUES (2000, 'worker', 'completed', 0, 'fts probe', 's1')`)

        db.exec(`UPDATE events SET summary = 'fts updated' WHERE id = 1`)
        const updated = db.prepare(
            "SELECT summary FROM events_fts WHERE rowid = 1"
        ).get() as { summary: string } | undefined
        expect(updated?.summary).toBe('fts updated')

        db.exec('DELETE FROM events WHERE id = 1')
        const deleted = db.prepare(
            "SELECT rowid FROM events_fts WHERE rowid = 1"
        ).get()
        expect(deleted).toBeNull()
    })

    it('ensureOverseerEventsSchema recreates broken delete/update triggers', () => {
        const db = new Database(':memory:')
        createV10Schema(db)
        ensureOverseerEventsSchema(db)
        db.exec('DROP TRIGGER IF EXISTS events_fts_delete')
        db.exec('DROP TRIGGER IF EXISTS events_fts_update')

        ensureOverseerEventsSchema(db)
        db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                 VALUES ('s1', 'default', 1000, 1000, 0)`)
        db.exec(`INSERT INTO events (ts, source_kind, event_type, attention_candidate, summary)
                 VALUES (2000, 'worker', 'completed', 0, 'before delete')`)

        expect(() => db.exec('DELETE FROM events WHERE id = 1')).not.toThrow()
    })

    it('deleteSession detaches overseer events instead of FK-failing', () => {
        const db = new Database(':memory:')
        db.exec('PRAGMA foreign_keys = ON')
        createV10Schema(db)
        ensureOverseerEventsSchema(db)
        db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                 VALUES ('s-del', 'default', 1000, 1000, 0)`)
        db.exec(`INSERT INTO events (ts, source_kind, event_type, attention_candidate, summary, related_session_id)
                 VALUES (2000, 'system', 'stale', 0, 'No agent output', 's-del')`)

        expect(deleteSession(db, 's-del', 'default')).toBe(true)
        const event = db.prepare('SELECT related_session_id FROM events WHERE id = 1').get() as {
            related_session_id: string | null
        }
        expect(event.related_session_id).toBeNull()
        expect(db.prepare("SELECT id FROM sessions WHERE id = 's-del'").get()).toBeNull()
    })

    it('repointSessionEvents moves FK refs for merge/reopen id swap', () => {
        const db = new Database(':memory:')
        db.exec('PRAGMA foreign_keys = ON')
        createV10Schema(db)
        ensureOverseerEventsSchema(db)
        db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                 VALUES ('s-old', 'default', 1000, 1000, 0),
                        ('s-new', 'default', 1000, 1000, 0)`)
        db.exec(`INSERT INTO events (ts, source_kind, event_type, attention_candidate, summary, related_session_id)
                 VALUES (2000, 'system', 'stale', 0, 'stale probe', 's-old'),
                        (3000, 'worker', 'completed', 0, 'done probe', 's-old')`)

        expect(repointSessionEvents(db, 's-old', 's-new')).toBe(2)
        expect(deleteSession(db, 's-old', 'default')).toBe(true)

        const rows = db.prepare(
            'SELECT related_session_id FROM events ORDER BY id'
        ).all() as Array<{ related_session_id: string | null }>
        expect(rows).toEqual([{ related_session_id: 's-new' }, { related_session_id: 's-new' }])
    })
})

function createV10Schema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            model TEXT,
            model_reasoning_effort TEXT,
            effort TEXT,
            service_tier TEXT,
            todos TEXT,
            todos_updated_at INTEGER,
            team_state TEXT,
            team_state_updated_at INTEGER,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            runner_state TEXT,
            runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            invoked_at INTEGER,
            scheduled_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            UNIQUE(platform, platform_user_id)
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );
    `)
}
