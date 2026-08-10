import { createHash, randomBytes } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { constantTimeEquals } from './crypto'

type GrantRecord = {
    hash: string
    machineId: string
    namespace: string
    expiresAt: number
}

/**
 * In-memory cache keyed by grant hash. SQLite may hold multiple hashes per
 * machine so a refresh can keep the previous grant valid until the runner
 * persists the replacement and acks (#1473 Blocker).
 */
const grantsByHash = new Map<string, GrantRecord>()
let grantDb: Database | null = null

const DEFAULT_TTL_MS = 365 * 24 * 60 * 60_000

function hashGrant(grant: string): string {
    return createHash('sha256').update(grant.trim(), 'utf8').digest('base64url')
}

function purgeExpired(now = Date.now()): void {
    for (const [hash, record] of grantsByHash) {
        if (record.expiresAt < now) {
            grantsByHash.delete(hash)
        }
    }
    if (!grantDb) {
        return
    }
    try {
        grantDb.prepare('DELETE FROM machine_reenroll_grants WHERE expires_at < ?').run(now)
    } catch {
        // Table may not exist yet during early boot.
    }
}

function loadRecord(hash: string, options?: { purgeExpired?: boolean }): GrantRecord | undefined {
    if (options?.purgeExpired !== false) {
        purgeExpired()
    }
    let record = grantsByHash.get(hash)
    if (record || !grantDb) {
        return record
    }
    const row = grantDb.prepare(`
        SELECT machine_id, namespace, grant_hash, expires_at
        FROM machine_reenroll_grants
        WHERE grant_hash = ?
    `).get(hash) as {
        machine_id: string
        namespace: string
        grant_hash: string
        expires_at: number
    } | undefined
    if (!row) {
        return undefined
    }
    record = {
        hash: row.grant_hash,
        machineId: row.machine_id,
        namespace: row.namespace,
        expiresAt: row.expires_at,
    }
    grantsByHash.set(hash, record)
    return record
}

export function bindReenrollGrantDb(db: Database): void {
    grantDb = db
    try {
        const rows = db.prepare(`
            SELECT machine_id, namespace, grant_hash, expires_at
            FROM machine_reenroll_grants
        `).all() as Array<{
            machine_id: string
            namespace: string
            grant_hash: string
            expires_at: number
        }>
        grantsByHash.clear()
        const now = Date.now()
        for (const row of rows) {
            if (row.expires_at < now) {
                db.prepare('DELETE FROM machine_reenroll_grants WHERE grant_hash = ?').run(row.grant_hash)
                continue
            }
            grantsByHash.set(row.grant_hash, {
                hash: row.grant_hash,
                machineId: row.machine_id,
                namespace: row.namespace,
                expiresAt: row.expires_at,
            })
        }
    } catch {
        // Table may not exist yet during early boot; migration creates it.
    }
}

/**
 * Issue a new grant without invalidating prior hashes for the machine.
 * Runner must persist the token then call {@link ackReenrollGrant}.
 */
export function issueReenrollGrant(options: {
    machineId: string
    namespace: string
    ttlMs?: number
}): { grant: string; expiresAt: number } {
    purgeExpired()
    const grant = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS)
    const hash = hashGrant(grant)
    const record: GrantRecord = {
        hash,
        machineId: options.machineId,
        namespace: options.namespace,
        expiresAt,
    }
    grantsByHash.set(hash, record)
    if (grantDb) {
        grantDb.prepare(`
            INSERT INTO machine_reenroll_grants (grant_hash, machine_id, namespace, expires_at)
            VALUES (@grant_hash, @machine_id, @namespace, @expires_at)
            ON CONFLICT(grant_hash) DO UPDATE SET
                machine_id = excluded.machine_id,
                namespace = excluded.namespace,
                expires_at = excluded.expires_at
        `).run({
            grant_hash: hash,
            machine_id: options.machineId,
            namespace: options.namespace,
            expires_at: expiresAt,
        })
    }
    return { grant, expiresAt }
}

/**
 * After the runner writes the grant to disk, drop every other hash for the
 * machine so only the durable token remains valid.
 */
export function ackReenrollGrant(options: {
    machineId: string
    namespace: string
    grant: string
}): boolean {
    const presented = options.grant.trim()
    if (!presented) {
        return false
    }
    const hash = hashGrant(presented)
    const record = loadRecord(hash)
    if (!record) {
        return false
    }
    if (record.machineId !== options.machineId || record.namespace !== options.namespace) {
        return false
    }
    for (const [otherHash, other] of [...grantsByHash.entries()]) {
        if (other.machineId === options.machineId && otherHash !== hash) {
            grantsByHash.delete(otherHash)
        }
    }
    if (grantDb) {
        grantDb.prepare(`
            DELETE FROM machine_reenroll_grants
            WHERE machine_id = ? AND grant_hash != ?
        `).run(options.machineId, hash)
    }
    return true
}

/** Check a grant without consuming it (migrate may still fail). */
export function verifyReenrollGrant(options: {
    machineId: string
    namespace: string
    grant: string
}): boolean {
    const presented = options.grant.trim()
    if (!presented) {
        return false
    }
    // Do not purge by wall-clock here — offline machines may sit longer than
    // any fixed TTL before cold start; consume/ack are the real invalidators.
    const record = loadRecord(hashGrant(presented), { purgeExpired: false })
    if (!record) {
        return false
    }
    if (record.machineId !== options.machineId || record.namespace !== options.namespace) {
        return false
    }
    return constantTimeEquals(record.hash, hashGrant(presented))
}

/**
 * Consume a one-time reenroll grant after migrate succeeded.
 * Deletes every grant for the source machine (old generation is done).
 */
export function consumeReenrollGrant(options: {
    machineId: string
    namespace: string
    grant: string
}): boolean {
    if (!verifyReenrollGrant(options)) {
        return false
    }
    for (const [hash, record] of [...grantsByHash.entries()]) {
        if (record.machineId === options.machineId) {
            grantsByHash.delete(hash)
        }
    }
    grantDb?.prepare('DELETE FROM machine_reenroll_grants WHERE machine_id = ?').run(options.machineId)
    return true
}

/** Test helper — clear in-memory grants between cases. */
export function clearReenrollGrantsForTests(): void {
    grantsByHash.clear()
    if (grantDb) {
        try {
            grantDb.prepare('DELETE FROM machine_reenroll_grants').run()
        } catch {
            // ignore
        }
    }
}
