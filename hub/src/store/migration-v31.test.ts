import { describe, expect, it, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v30 to v31 (blocked ack)', () => {
    it('fresh DB is v31 with blocked_ack columns', () => {
        const store = new Store(':memory:')
        const db = (store as unknown as { db: Database }).db
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(31)
        const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        const names = new Set(columns.map((row) => row.name))
        expect(names.has('blocked_ack_at')).toBe(true)
        expect(names.has('blocked_ack_reason')).toBe(true)
        store.close()
    })

    it('adds blocked_ack columns when upgrading from v30', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v31-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec(`
            ALTER TABLE sessions DROP COLUMN blocked_ack_at;
            ALTER TABLE sessions DROP COLUMN blocked_ack_reason;
            PRAGMA user_version = 30;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        try {
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(31)
            const columns = internalDb.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
            const names = new Set(columns.map((row) => row.name))
            expect(names.has('blocked_ack_at')).toBe(true)
            expect(names.has('blocked_ack_reason')).toBe(true)
        } finally {
            migrated.close()
        }
    })
})
