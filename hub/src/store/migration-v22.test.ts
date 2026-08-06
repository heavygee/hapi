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

describe('schema migration v21 to v22 (soup: upstream #1115 pin)', () => {
    it('adds the pinned column with an unpinned default', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v22-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec('ALTER TABLE sessions DROP COLUMN pinned')
        // Soup v21 = upstream #1390 usage semantics; pin is the v22 step.
        legacy.exec('PRAGMA user_version = 21')
        legacy.close()

        const migrated = new Store(dbPath)
        const internalDb = (migrated as unknown as { db: Database }).db
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(22)
        const session = migrated.sessions.getOrCreateSession('migration-pin', {}, null, 'default')
        expect(session.pinned).toBe(false)
        migrated.close()
    })
})
