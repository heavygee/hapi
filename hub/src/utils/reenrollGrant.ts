import { createHash, randomBytes } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { constantTimeEquals } from './crypto'

type GrantRecord = {
    hash: string
    machineId: string
    namespace: string
    expiresAt: number
}

/** In-memory cache; SQLite is source of truth across hub restarts (#1473). */
const grantsById = new Map<string, GrantRecord>()
let grantDb: Database | null = null

const DEFAULT_TTL_MS = 5 * 60_000

function hashGrant(grant: string): string {
    return createHash('sha256').update(grant.trim(), 'utf8').digest('base64url')
}

export function bindReenrollGrantDb(db: Database): void {
    grantDb = db
    // Warm cache from durable rows.
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
        grantsById.clear()
        const now = Date.now()
        for (const row of rows) {
            if (row.expires_at < now) {
                db.prepare('DELETE FROM machine_reenroll_grants WHERE machine_id = ?').run(row.machine_id)
                continue
            }
            grantsById.set(row.machine_id, {
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

export function issueReenrollGrant(options: {
    machineId: string
    namespace: string
    ttlMs?: number
}): { grant: string; expiresAt: number } {
    const grant = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS)
    const hash = hashGrant(grant)
    grantsById.set(options.machineId, {
        hash,
        machineId: options.machineId,
        namespace: options.namespace,
        expiresAt,
    })
    if (grantDb) {
        grantDb.prepare(`
            INSERT INTO machine_reenroll_grants (machine_id, namespace, grant_hash, expires_at)
            VALUES (@machine_id, @namespace, @grant_hash, @expires_at)
            ON CONFLICT(machine_id) DO UPDATE SET
                namespace = excluded.namespace,
                grant_hash = excluded.grant_hash,
                expires_at = excluded.expires_at
        `).run({
            machine_id: options.machineId,
            namespace: options.namespace,
            grant_hash: hash,
            expires_at: expiresAt,
        })
    }
    return { grant, expiresAt }
}

/**
 * Consume a one-time reenroll grant for the source machine.
 * Returns true only once per issued grant before expiry.
 */
export function consumeReenrollGrant(options: {
    machineId: string
    namespace: string
    grant: string
}): boolean {
    const presented = options.grant.trim()
    if (!presented) {
        return false
    }
    let record = grantsById.get(options.machineId)
    if (!record && grantDb) {
        const row = grantDb.prepare(`
            SELECT machine_id, namespace, grant_hash, expires_at
            FROM machine_reenroll_grants
            WHERE machine_id = ?
        `).get(options.machineId) as {
            machine_id: string
            namespace: string
            grant_hash: string
            expires_at: number
        } | undefined
        if (row) {
            record = {
                hash: row.grant_hash,
                machineId: row.machine_id,
                namespace: row.namespace,
                expiresAt: row.expires_at,
            }
            grantsById.set(options.machineId, record)
        }
    }
    if (!record) {
        return false
    }
    if (record.namespace !== options.namespace) {
        return false
    }
    if (record.expiresAt < Date.now()) {
        grantsById.delete(options.machineId)
        grantDb?.prepare('DELETE FROM machine_reenroll_grants WHERE machine_id = ?').run(options.machineId)
        return false
    }
    if (!constantTimeEquals(record.hash, hashGrant(presented))) {
        return false
    }
    grantsById.delete(options.machineId)
    grantDb?.prepare('DELETE FROM machine_reenroll_grants WHERE machine_id = ?').run(options.machineId)
    return true
}

/** Test helper — clear in-memory grants between cases. */
export function clearReenrollGrantsForTests(): void {
    grantsById.clear()
    if (grantDb) {
        try {
            grantDb.prepare('DELETE FROM machine_reenroll_grants').run()
        } catch {
            // ignore
        }
    }
}
