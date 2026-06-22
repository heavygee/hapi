import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

/**
 * Soup-only tests for V11→V12: scratchlist v2.2 table with attachments column.
 *
 * In driver-manifest soup, feat/companion-fcm-push-api owns v10→v11 (fcm_devices).
 * This branch owns v11→v12 (session_scratchlist + attachments). NOT standalone-
 * testable without the FCM layer — pass inside soup integration tree only.
 */
describe('Store V11→V12 migration (soup): session_scratchlist + attachments', () => {
    it('fresh DB has session_scratchlist table with attachments column', () => {
        const store = new Store(':memory:')
        const cols = getColumns(store, 'session_scratchlist')
        expect(cols).toContain('session_id')
        expect(cols).toContain('entry_id')
        expect(cols).toContain('text')
        expect(cols).toContain('created_at')
        expect(cols).toContain('updated_at')
        expect(cols).toContain('attachments')
    })

    it('fresh DB has the (session_id, created_at) index', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db
        const rows = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_scratchlist_session_created'"
        ).all() as Array<{ name: string }>
        expect(rows).toHaveLength(1)
    })

    it('V11 DB (fcm present, no scratchlist) migrates to V12 via Store', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v12-soup-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV11Schema(db)
            db.exec('PRAGMA user_version = 11')
            db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                     VALUES ('s1', 'default', 1000, 1000, 0)`)
            db.close()

            store = new Store(dbPath)
            const cols = getColumns(store, 'session_scratchlist')
            expect(cols).toContain('attachments')
            expect(store.scratchlist.count('s1')).toBe(0)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('V12 DB reopen is idempotent: schema unchanged', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v12-idempotent-'))
        const dbPath = join(dir, 'test.db')
        let store1: Store | undefined
        let store2: Store | undefined
        try {
            store1 = new Store(dbPath)
            const cols1 = getColumns(store1, 'session_scratchlist')

            store2 = new Store(dbPath)
            const cols2 = getColumns(store2, 'session_scratchlist')
            expect(cols2).toEqual(cols1)
        } finally {
            store2?.close()
            store1?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('cascade-delete: scratchlist entries are removed when their session is deleted', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')
        const create1 = store.scratchlist.create(session.id, 'note one')
        const create2 = store.scratchlist.create(session.id, 'note two')
        expect(create1.outcome).toBe('created')
        expect(create2.outcome).toBe('created')
        expect(store.scratchlist.count(session.id)).toBe(2)

        await store.sessions.deleteSession(session.id, 'default')
        expect(store.scratchlist.count(session.id)).toBe(0)
    })
})

function getColumns(store: Store, table: string): string[] {
    const db: Database = (store as unknown as { db: Database }).db
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((r) => r.name)
}

/** Soup V11 shape: post-FCM layer (fcm_devices), no session_scratchlist yet. */
function createV11Schema(db: Database): void {
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

        CREATE TABLE IF NOT EXISTS fcm_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            token TEXT NOT NULL,
            platform TEXT NOT NULL,
            device_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(namespace, device_id, platform)
        );
    `)
}
