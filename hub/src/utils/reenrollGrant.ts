import { createHash, randomBytes } from 'node:crypto'
import { constantTimeEquals } from './crypto'

type GrantRecord = {
    hash: string
    machineId: string
    namespace: string
    expiresAt: number
}

/** In-memory one-time grants for cold-restart session migrate (#1473). */
const grantsById = new Map<string, GrantRecord>()

const DEFAULT_TTL_MS = 5 * 60_000

function hashGrant(grant: string): string {
    return createHash('sha256').update(grant.trim(), 'utf8').digest('base64url')
}

export function issueReenrollGrant(options: {
    machineId: string
    namespace: string
    ttlMs?: number
}): { grant: string; expiresAt: number } {
    const grant = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS)
    grantsById.set(options.machineId, {
        hash: hashGrant(grant),
        machineId: options.machineId,
        namespace: options.namespace,
        expiresAt,
    })
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
    const record = grantsById.get(options.machineId)
    if (!record) {
        return false
    }
    if (record.namespace !== options.namespace) {
        return false
    }
    if (record.expiresAt < Date.now()) {
        grantsById.delete(options.machineId)
        return false
    }
    if (!constantTimeEquals(record.hash, hashGrant(presented))) {
        return false
    }
    grantsById.delete(options.machineId)
    return true
}

/** Test helper — clear in-memory grants between cases. */
export function clearReenrollGrantsForTests(): void {
    grantsById.clear()
}
