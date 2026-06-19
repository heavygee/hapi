import { describe, expect, it } from 'bun:test'
import { Store } from './index'
import { downgradeEventsSchemaV11ToV10 } from './events'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Store V10→V11 migration: events substrate', () => {
    it('fresh DB has events, event_links, and events_fts', () => {
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

    it('V10 DB migrates to V11 and can insert events', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-test-'))
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
                summary: 'Migration smoke event',
                relatedSessionId: 's1',
                provenance: 'test'
            })
            expect(event?.summary).toBe('Migration smoke event')
            expect(store.events.count()).toBe(1)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('downgrade v11 -> v10 removes events tables', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        downgradeEventsSchemaV11ToV10(db)
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(10)
        const events = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
        ).get()
        expect(events).toBeNull()
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
