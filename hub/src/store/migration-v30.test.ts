import { describe, expect, it, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'
import { MAX_INDEXED_MESSAGE_CHARACTERS } from './messageContentSearch'

const tempDirs: string[] = []

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v29 to v30 (message content search)', () => {
    it('fresh DB is v30 with FTS tables', () => {
        const store = new Store(':memory:')
        const db = (store as unknown as { db: Database }).db
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(30)
        for (const name of [
            'message_content_search',
            'message_content_search_lookup',
            'message_content_search_short',
        ]) {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
            ).get(name) as { name: string } | null
            expect(row?.name).toBe(name)
        }
        store.close()
    })

    it('creates and backfills the message content search index from v29', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v30-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession(
            'migration-search',
            { path: '/tmp/migration-search' },
            null,
            'default'
        )
        initial.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'backfill this message' }
        })
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec(`
            DROP TABLE IF EXISTS message_content_search;
            DROP TABLE IF EXISTS message_content_search_lookup;
            DROP TABLE IF EXISTS message_content_search_short;
            PRAGMA user_version = 29;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('backfill this', 'default')[0]?.sessionId)
                .toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(30)
            const short = internalDb.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_content_search_short'"
            ).get() as { name: string } | null
            expect(short?.name).toBe('message_content_search_short')
        } finally {
            migrated.close()
        }
    })

    it('bounds indexed text and supports short-query grams after rebuild', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'migration-short-query',
            { path: '/tmp/migration-short-query' },
            null,
            'default'
        )
        const text = `你好，短查询索引 ${Array.from({ length: MAX_INDEXED_MESSAGE_CHARACTERS + 1024 }, (_, index) =>
            String.fromCodePoint(0x1000 + index)
        ).join('')} tail-migration-needle`
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text }
        })
        expect(store.messages.searchContent('你好', 'default')[0]?.sessionId).toBe(session.id)
        expect(store.messages.searchContent('tail-migration-needle', 'default')[0]?.sessionId)
            .toBe(session.id)
        const db = (store as unknown as { db: Database }).db
        const indexed = db.prepare(
            'SELECT searchable_text FROM message_content_search WHERE message_id IS NOT NULL LIMIT 1'
        ).get() as { searchable_text: string } | undefined
        expect(indexed?.searchable_text.length).toBeLessThanOrEqual(MAX_INDEXED_MESSAGE_CHARACTERS)
        expect(indexed?.searchable_text).toContain('tail-migration-needle')
        store.close()
    })
})
