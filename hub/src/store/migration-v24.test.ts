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

describe('schema migrations through v28', () => {
    it('adds fcm_devices.push_key to a V23 database and keeps existing rows', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec(`
            ALTER TABLE fcm_devices DROP COLUMN push_key;
            INSERT INTO fcm_devices (namespace, token, platform, device_id, created_at, updated_at)
            VALUES ('default', 'fcm-tok-1', 'phone', 'pixel-1', 1, 1);
            PRAGMA user_version = 23;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        const internalDb = (migrated as unknown as { db: Database }).db
        const columns = internalDb.prepare('PRAGMA table_info(fcm_devices)').all() as Array<{ name: string }>
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

        expect(columns.some((col) => col.name === 'push_key')).toBe(true)
        const messageColumns = internalDb.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        expect(messageColumns.some((col) => col.name === 'delivery_state')).toBe(true)
        expect(version.user_version).toBe(32)

        // Existing Android rows survive with a NULL push key.
        const devices = migrated.fcm.getDevicesByNamespace('default')
        expect(devices).toHaveLength(1)
        expect(devices[0].token).toBe('fcm-tok-1')
        expect(devices[0].pushKey).toBeNull()

        // And the migrated DB accepts new iOS rows.
        migrated.fcm.upsertDevice('default', {
            token: 'a1b2',
            platform: 'ios',
            deviceId: 'iphone-1',
            pushKey: Buffer.alloc(32, 7).toString('base64')
        })
        expect(migrated.fcm.getDevicesByNamespace('default', ['ios'])).toHaveLength(1)
        migrated.close()
    })

    it('adds messages.delivery_state to an already-upgraded V24 database', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-delivery-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec(`
            -- V26/V27 indexes depend on delivery_state and did not exist in V24.
            -- SQLite refuses to drop a column an index references, so a genuine
            -- V24 fixture must drop them first. Restores upstream 5fd1179d2,
            -- which a later soup merge resolution reverted while bumping the
            -- version expectations below — leaving the suite red and every
            -- remat --verify blocked.
            -- IF EXISTS: the fork's schema currently creates only the
            -- immediate-queued index. Naming an absent one would make this
            -- fixture rot again the next time the index set changes.
            DROP INDEX IF EXISTS idx_messages_immediate_queued;
            DROP INDEX IF EXISTS idx_messages_future_scheduled_queued;
            ALTER TABLE messages DROP COLUMN delivery_state;
            PRAGMA user_version = 24;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        const internalDb = (migrated as unknown as { db: Database }).db
        const columns = internalDb.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        const indexes = internalDb.prepare('PRAGMA index_list(messages)').all() as Array<{ name: string }>
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(columns.some((col) => col.name === 'delivery_state')).toBe(true)
        expect(version.user_version).toBe(32)
        // The migration must put the indexes back, not just the column.
        expect(indexes.map((index) => index.name)).toContain('idx_messages_immediate_queued')
        migrated.close()
    })
})
