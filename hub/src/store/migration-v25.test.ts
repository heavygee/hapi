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

describe('schema migration v24 to v27 (via grants/replays)', () => {
    it('adds machine_reenroll_grants and advances user_version', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v25-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec('DROP TABLE IF EXISTS machine_reenroll_grants')
        legacy.exec('PRAGMA user_version = 24')
        legacy.close()

        const migrated = new Store(dbPath)
        const internalDb = (migrated as unknown as { db: Database }).db
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(31)
        const table = internalDb.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'machine_reenroll_grants'"
        ).get() as { name: string } | undefined
        expect(table?.name).toBe('machine_reenroll_grants')
        const columns = (internalDb.prepare('PRAGMA table_info(machine_reenroll_grants)').all() as Array<{ name: string }>)
            .map((row) => row.name)
        expect(columns).toContain('grant_hash')
        expect(columns).toContain('machine_id')
        migrated.close()
    })
})
