import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Store } from './index'

function getColumns(store: Store, table: string): string[] {
    const db: Database = (store as unknown as { db: Database }).db
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((row) => row.name)
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        Bun.gc(true)
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
})

describe('schema migrations through v33', () => {
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
        try {
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
            const columns = internalDb.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
            expect(columns.map((column) => column.name)).toContain('delivery_state')
            expect(version.user_version).toBe(34)
        } finally {
            migrated.close()
        }
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

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('backfill this', 'default')[0]?.sessionId).toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(34)
        } finally {
            migrated.close()
        }
    })

    it('adds the indexed message lookup to an existing v27 search schema', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v27-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession('migration-lookup', { path: '/tmp/migration-lookup' }, null, 'default')
        initial.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'backfill the lookup table' }
        })
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec(`
            DROP TABLE IF EXISTS message_content_search_lookup;
            DROP TABLE IF EXISTS message_content_search_short;
            PRAGMA user_version = 27;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('lookup table', 'default')[0]?.sessionId).toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const lookup = internalDb.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_content_search_lookup'"
            ).get() as { name: string } | null
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(lookup?.name).toBe('message_content_search_lookup')
            expect(version.user_version).toBe(34)
        } finally {
            migrated.close()
        }
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
        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('你好', 'default')[0]?.sessionId).toBe(session.id)
            expect(migrated.messages.searchContent('tail-migration-needle', 'default')[0]?.sessionId)
                .toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const shortIndex = internalDb.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_content_search_short'"
            ).get() as { name: string } | null
            const lookupColumns = internalDb.prepare(
                'PRAGMA table_info(message_content_search_lookup)'
            ).all() as Array<{ name: string }>
            const target = internalDb.prepare(
                'SELECT target_message_id FROM message_content_search_lookup WHERE message_id = ?'
            ).get(message.id) as { target_message_id: string } | undefined
            const indexed = internalDb.prepare(
                'SELECT searchable_text FROM message_content_search WHERE message_id = ?'
            ).get(message.id) as { searchable_text: string } | undefined
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(shortIndex?.name).toBe('message_content_search_short')
            expect(lookupColumns.map((column) => column.name)).toContain('target_message_id')
            expect(target?.target_message_id).toBe(message.id)
            expect(indexed?.searchable_text.length).toBeLessThanOrEqual(MAX_INDEXED_MESSAGE_CHARACTERS)
            expect(indexed?.searchable_text).toContain('tail-migration-needle')
            expect(version.user_version).toBe(34)
        } finally {
            migrated.close()
        }
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
        initial.close()

        // Simulate the v29 derived index without deleting any user data. The
        // old 16 KiB head/tail window misses the marker near its midpoint.
        const legacy = new Database(dbPath)
        const legacyIndexedText = `${text.slice(0, 8_191)} ${text.slice(-8_192)}`
        legacy.prepare(
            'UPDATE message_content_search SET searchable_text = ? WHERE message_id = ?'
        ).run(legacyIndexedText, message.id)
        legacy.prepare(
            `UPDATE message_content_search_lookup
             SET is_truncated = 0, short_index_truncated = 0
             WHERE target_message_id = ?`
        ).run(message.id)
        legacy.exec('PRAGMA user_version = 29')
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('v30-middle-needle', 'default'))
                .toMatchObject([{ sessionId: session.id, truncated: true }])

            const internalDb = (migrated as unknown as { db: Database }).db
            const indexed = internalDb.prepare(`
                SELECT searchable_text
                FROM message_content_search
                WHERE message_id = ?
            `).get(message.id) as { searchable_text: string } | undefined
            const metadata = internalDb.prepare(`
                SELECT is_truncated, short_index_truncated
                FROM message_content_search_lookup
                WHERE target_message_id = ?
            `).get(message.id) as { is_truncated: number; short_index_truncated: number } | undefined
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

            expect(indexed?.searchable_text.length).toBeLessThanOrEqual(MAX_INDEXED_MESSAGE_CHARACTERS)
            expect(indexed?.searchable_text).toContain('v30-middle-needle')
            expect(metadata?.is_truncated).toBe(1)
            expect(metadata?.short_index_truncated).toBe(1)
            expect(version.user_version).toBe(34)
        } finally {
            migrated.close()
        }
    })
})
