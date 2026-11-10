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
        expect(version.user_version).toBe(32)
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
        legacy.exec('ALTER TABLE messages DROP COLUMN content_revision; PRAGMA user_version = 29;')
        legacy.close()
        const migrated = new Store(path)
        expect(migrated.sessions.getSession(id)?.readState).toEqual({ readRevision: 0, manualUnread: false, version: 0 })
        expect(migrated.sessions.getSession(id)?.contentRevision).toBe(0)
        expect(migrated.messages.getMessages(id)).toHaveLength(1)
        migrated.messages.addMessage(id, reply, 'new')
        migrated.close()
        const restarted = new Store(path)
        expect(restarted.sessions.getSession(id)?.contentRevision).toBe(1)
        expect(restarted.sessions.getSession(id)?.readState?.readRevision).toBe(0)
        restarted.close()
    } finally { Bun.gc(true); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) }
})
it('creates and backfills search tables when upgrading a base v30 database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-search-v30-migration-'))
    try {
        const path = join(dir, 'hub.db')
        const before = new Store(path)
        const session = before.sessions.getOrCreateSession('search-v30', { path: '/tmp/search-v30' }, null, 'default')
        before.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'upgrade searchable text' } })
        before.close()
        const legacy = new Database(path)
        legacy.exec(`
            DROP TABLE message_content_search_short;
            DROP TABLE message_content_search_lookup;
            DROP TABLE message_content_search;
            PRAGMA user_version = 30;
        `)
        legacy.close()
        const migrated = new Store(path)
        try {
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(34)
            expect(migrated.messages.searchContent('searchable', 'default')[0]?.sessionId).toBe(session.id)
        } finally { migrated.close() }
    } finally { Bun.gc(true); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) }
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
            expect(version.user_version).toBe(34)
            expect(migrated.sessions.getSession(session.id)?.readState).toEqual({ readRevision: 0, manualUnread: false, version: 0 })
            migrated.messages.addMessage(session.id, {
                role: 'user', content: { type: 'text', text: 'genuine v26 searchable text' }
            })
            const read = migrated.sessions.updateReadState(session.id, 'default', {
                type: 'unread', expectedVersion: 0
            })
            expect(read?.readState).toEqual({ readRevision: 0, manualUnread: true, version: 1 })
            expect(migrated.messages.searchContent('genuine v26', 'default')[0]?.sessionId).toBe(session.id)
        } finally { migrated.close() }
    } finally { Bun.gc(true); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) }
})
