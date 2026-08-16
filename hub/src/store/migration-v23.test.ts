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

describe('schema migration from v22', () => {
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
            expect(version.user_version).toBe(26)
        } finally {
            migrated.close()
        }
    })
})

describe('schema migration v23 to v26', () => {
    it('creates and backfills the message content search index', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession('migration-search', { path: '/tmp/migration-search' }, null, 'default')
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
            PRAGMA user_version = 23;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('backfill this', 'default')[0]?.sessionId).toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(26)
        } finally {
            migrated.close()
        }
    })

    it('adds the indexed message lookup to an existing v24 search schema', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v25-'))
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
            PRAGMA user_version = 24;
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
            expect(version.user_version).toBe(26)
        } finally {
            migrated.close()
        }
    })

    it('backfills indexed short-query grams for an existing v25 search schema', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v26-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession('migration-short-query', { path: '/tmp/migration-short-query' }, null, 'default')
        initial.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: '你好，短查询索引' }
        })
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec('DROP TABLE IF EXISTS message_content_search_short; PRAGMA user_version = 25;')
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            expect(migrated.messages.searchContent('你好', 'default')[0]?.sessionId).toBe(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const shortIndex = internalDb.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_content_search_short'"
            ).get() as { name: string } | null
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(shortIndex?.name).toBe('message_content_search_short')
            expect(version.user_version).toBe(26)
        } finally {
            migrated.close()
        }
    })
})
