import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import {
    ackReenrollGrant,
    bindReenrollGrantDb,
    clearReenrollGrantMemoryForTests,
    clearReenrollGrantsForTests,
    consumeReenrollGrant,
    getConsumedReenrollReplay,
    issueReenrollGrant,
    unbindReenrollGrantDbForTests,
    verifyReenrollGrant,
} from './reenrollGrant'

describe('reenrollGrant (#1473)', () => {
    beforeEach(() => {
        unbindReenrollGrantDbForTests()
        clearReenrollGrantsForTests()
    })

    it('issues a one-time grant that migrates only once', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(true)
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(false)
    })

    it('rejects wrong namespace or machine id', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'other',
            grant,
            toMachineId: 'machine-new',
        })).toBe(false)
        expect(consumeReenrollGrant({
            machineId: 'machine-other',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(false)
    })

    it('keeps the previous grant valid until the replacement is acked', () => {
        const first = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        const second = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: first.grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
        expect(ackReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: first.grant,
        })).toBe(false)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
    })

    it('verify does not consume; consume after success deletes', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(true)
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(false)
    })

    it('persists consumed replay across bind/reload (#1473 Major)', () => {
        const db = new Database(':memory:')
        db.exec(`
            CREATE TABLE machine_reenroll_grants (
                grant_hash TEXT PRIMARY KEY,
                machine_id TEXT NOT NULL,
                namespace TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE machine_reenroll_replays (
                grant_hash TEXT PRIMARY KEY,
                from_machine_id TEXT NOT NULL,
                to_machine_id TEXT NOT NULL,
                namespace TEXT NOT NULL
            );
        `)
        bindReenrollGrantDb(db)
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-mid',
        })).toBe(true)

        // Simulate Hub restart: clear process Maps, rebind same SQLite.
        clearReenrollGrantMemoryForTests()
        bindReenrollGrantDb(db)
        const replay = getConsumedReenrollReplay(grant)
        expect(replay).toEqual({
            grantHash: expect.any(String),
            fromMachineId: 'machine-old',
            toMachineId: 'machine-mid',
            namespace: 'default',
        })
        unbindReenrollGrantDbForTests()
        db.close()
    })
})
