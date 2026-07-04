import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'
import { applySoupV10ToV11Migration, SOUP_V11_TABLES } from './schemaV11Soup'

describe('Store soup combined V10→V11 migration', () => {
    it('applySoupV10ToV11Migration plus Store init creates full soup v11 surface', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-soup-'))
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
            applySoupV10ToV11Migration(db)
            db.exec('PRAGMA user_version = 11')
            db.close()

            store = new Store(dbPath)
            const dbAfter: Database = (store as unknown as { db: Database }).db
            for (const table of SOUP_V11_TABLES) {
                expect(tableExists(dbAfter, table), `missing ${table}`).toBe(true)
            }

            dbAfter.exec(`INSERT INTO fcm_devices (namespace, token, platform, device_id, created_at, updated_at)
                     VALUES ('default', 'tok', 'phone', 'dev-1', 1000, 1000)`)
            dbAfter.exec(`INSERT INTO session_scratchlist (session_id, entry_id, text, created_at, updated_at)
                     VALUES ('s1', 'e1', 'note', 1000, 1000)`)
            const event = store.events.insert({
                ts: 2000,
                sourceKind: 'worker',
                sourceRef: 'test',
                eventType: 'completed',
                attentionCandidate: 0,
                summary: 'soup smoke',
                relatedSessionId: 's1',
                provenance: 'test'
            })
            expect(event?.summary).toBe('soup smoke')
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function tableExists(db: Database, name: string): boolean {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ? LIMIT 1"
    ).get(name) as { name: string } | null
    return row !== null
}

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
