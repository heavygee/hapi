import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

function getColumns(store: Store, table: string): string[] {
    const db: Database = (store as unknown as { db: Database }).db
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((row) => row.name)
}

describe('Store V22→V23 (soup); fresh schema still includes migration: session_jobs table', () => {
    it('fresh DB has session_jobs with expected columns', () => {
        const store = new Store(':memory:')
        const cols = getColumns(store, 'session_jobs')
        expect(cols).toContain('session_id')
        expect(cols).toContain('job_key')
        expect(cols).toContain('label')
        expect(cols).toContain('status')
        expect(cols).toContain('done')
        expect(cols).toContain('total')
        expect(cols).toContain('remaining')
        expect(cols).toContain('heartbeat_at')
        expect(cols).toContain('started_at')
        expect(cols).toContain('updated_at')
        store.close()
    })

    it('upserts, patches, deletes a job and surfaces primary running', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')

        const created = store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            remaining: 100,
            unit: 'tracks'
        })
        expect(created.outcome).toBe('upserted')
        if (created.outcome !== 'upserted') throw new Error('unreachable')

        const primary = store.sessionJobs.getPrimaryRunning(session.id)
        expect(primary?.key).toBe('beets')
        expect(primary?.remaining).toBe(100)

        store.sessionJobs.upsert(session.id, 'newer', {
            label: 'sidecar',
            status: 'running',
            remaining: 1,
            startedAt: (primary!.startedAt) + 60_000
        })
        store.sessionJobs.patch(session.id, 'newer', { remaining: 0 })
        expect(store.sessionJobs.getPrimaryRunning(session.id)?.key).toBe('beets')
        expect(store.sessionJobs.delete(session.id, 'newer')).toBe(true)

        const patched = store.sessionJobs.patch(session.id, 'beets', { remaining: 80 })
        expect(patched?.remaining).toBe(80)

        expect(store.sessionJobs.delete(session.id, 'beets')).toBe(true)
        expect(store.sessionJobs.getPrimaryRunning(session.id)).toBeNull()
        store.close()
    })

    it('cascade-deletes jobs when session is deleted', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')
        store.sessionJobs.upsert(session.id, 'job', { label: 'x', status: 'running' })
        expect(store.sessionJobs.list(session.id)).toHaveLength(1)
        await store.sessions.deleteSession(session.id, 'default')
        expect(store.sessionJobs.list(session.id)).toHaveLength(0)
        store.close()
    })

    it('preserves startedAt on PUT without body.startedAt; honors explicit correction', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')
        const historical = 1_785_304_595_000

        const created = store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            remaining: 10
        }, 2_000)
        expect(created.outcome).toBe('upserted')
        if (created.outcome !== 'upserted') throw new Error('unreachable')
        expect(created.job.startedAt).toBe(2_000)

        const progress = store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            remaining: 9
        }, 3_000)
        expect(progress.outcome).toBe('upserted')
        if (progress.outcome !== 'upserted') throw new Error('unreachable')
        expect(progress.job.startedAt).toBe(2_000)
        expect(progress.job.remaining).toBe(9)

        const corrected = store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            remaining: 9,
            startedAt: historical
        }, 4_000)
        expect(corrected.outcome).toBe('upserted')
        if (corrected.outcome !== 'upserted') throw new Error('unreachable')
        expect(corrected.job.startedAt).toBe(historical)

        const patched = store.sessionJobs.patch(session.id, 'beets', { remaining: 8 }, 5_000)
        expect(patched?.startedAt).toBe(historical)
        expect(patched?.remaining).toBe(8)
        store.close()
    })

    it('transfers jobs on merge without colliding keys', () => {
        const store = new Store(':memory:')
        const oldSession = store.sessions.getOrCreateSession('old', { path: '/a' }, null, 'default')
        const newSession = store.sessions.getOrCreateSession('new', { path: '/b' }, null, 'default')
        store.sessionJobs.upsert(oldSession.id, 'beets', {
            label: 'beets',
            status: 'running',
            remaining: 5
        })
        const result = store.sessionJobs.transfer(oldSession.id, newSession.id)
        expect(result.moved).toBe(1)
        expect(store.sessionJobs.getPrimaryRunning(newSession.id)?.remaining).toBe(5)
        expect(store.sessionJobs.list(oldSession.id)).toHaveLength(0)
        store.close()
    })
})

describe('schema migration v22 to v23', () => {
    it('adds events and event_links tables to a V22 database', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v23-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec(`
            DROP TABLE IF EXISTS event_links;
            DROP TABLE IF EXISTS events;
            PRAGMA user_version = 22;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        const internalDb = (migrated as unknown as { db: Database }).db
        const events = internalDb.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'"
        ).get() as { name: string } | null
        const links = internalDb.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_links'"
        ).get() as { name: string } | null
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

        expect(events?.name).toBe('events')
        expect(links?.name).toBe('event_links')
        expect(version.user_version).toBe(28)
        migrated.close()
    })
})

describe('dual ledger: work-graph events + overseer_events', () => {
    it('fresh DB keeps both ledgers under distinct table names', () => {
        const store = new Store(':memory:')
        const db = (store as unknown as { db: Database }).db
        const colsEvents = getColumns(store, 'events')
        const colsOverseer = getColumns(store, 'overseer_events')
        expect(colsEvents).toContain('principal_json')
        expect(colsEvents).toContain('namespace')
        expect(colsEvents).not.toContain('attention_candidate')
        expect(colsOverseer).toContain('attention_candidate')
        expect(colsOverseer).not.toContain('principal_json')
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(28)
        store.close()
    })

    it('rehomes soup Overseer-shaped events off the work-graph name on V23→V24', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-overseer-rehome-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        // Build a soup-shaped V23 DB (Overseer owns `events`), then open with V24 code.
        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec(`
            DROP TABLE IF EXISTS event_links;
            DROP TABLE IF EXISTS events;
            DROP TABLE IF EXISTS overseer_event_links;
            DROP TABLE IF EXISTS overseer_events;
            DROP TABLE IF EXISTS events_fts;
            DROP TABLE IF EXISTS overseer_events_fts;
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
            INSERT INTO events (ts, source_kind, event_type, attention_candidate, summary)
            VALUES (1, 'system', 'progress', 0, 'keep-me');
            CREATE TABLE event_links (
                id TEXT PRIMARY KEY,
                from_event_id INTEGER NOT NULL,
                to_event_id INTEGER NOT NULL,
                relation_type TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                metadata_json TEXT
            );
            PRAGMA user_version = 23;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        const db = (migrated as unknown as { db: Database }).db
        const overseerCols = getColumns(migrated, 'overseer_events')
        const workGraphCols = getColumns(migrated, 'events')
        expect(overseerCols).toContain('attention_candidate')
        expect(workGraphCols).toContain('principal_json')
        const kept = db.prepare(
            "SELECT summary FROM overseer_events WHERE summary = 'keep-me'"
        ).get() as { summary: string } | undefined
        expect(kept?.summary).toBe('keep-me')
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(28)
        migrated.close()
    })
})
