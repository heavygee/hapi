import {
    existsSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
    chmodSync,
    mkdirSync,
    renameSync,
    openSync,
    fsyncSync,
    closeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { configuration } from '@/configuration'

export type PersistedReenrollGrant = {
    fromMachineId: string
    machineTag: string
    grant: string
    expiresAt: number
}

function grantPath(): string {
    return join(configuration.happyHomeDir, 'runner-reenroll.grant.json')
}

function pendingGrantPath(): string {
    return `${grantPath()}.pending`
}

function parseGrant(raw: string): PersistedReenrollGrant | null {
    try {
        const parsed = JSON.parse(raw) as PersistedReenrollGrant
        if (
            typeof parsed.fromMachineId !== 'string'
            || typeof parsed.machineTag !== 'string'
            || typeof parsed.grant !== 'string'
            || typeof parsed.expiresAt !== 'number'
        ) {
            return null
        }
        return {
            fromMachineId: parsed.fromMachineId.trim(),
            machineTag: parsed.machineTag.trim(),
            grant: parsed.grant.trim(),
            expiresAt: parsed.expiresAt,
        }
    } catch {
        return null
    }
}

function fsyncPath(path: string): void {
    const fd = openSync(path, 'r')
    try {
        fsyncSync(fd)
    } finally {
        closeSync(fd)
    }
}

function fsyncParent(path: string): void {
    fsyncPath(dirname(path))
}

/**
 * Stage a replacement grant without destroying the durable token.
 * Call {@link commitReenrollGrant} only after hub ack (#1473 Major).
 */
export function writeReenrollGrantPending(grant: PersistedReenrollGrant): void {
    const path = pendingGrantPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify(grant), { mode: 0o600 })
    chmodSync(path, 0o600)
    // Durability before hub ack — power loss must not drop the only token
    // that still matches a newly issued hash (#1473 Major).
    fsyncPath(path)
    fsyncParent(path)
}

/** Promote the staged grant after hub ack. */
export function commitReenrollGrant(): void {
    const pending = pendingGrantPath()
    const finalPath = grantPath()
    if (!existsSync(pending)) {
        return
    }
    mkdirSync(dirname(finalPath), { recursive: true, mode: 0o700 })
    renameSync(pending, finalPath)
    chmodSync(finalPath, 0o600)
    fsyncPath(finalPath)
    fsyncParent(finalPath)
}

/** @deprecated Prefer writeReenrollGrantPending + commitReenrollGrant. */
export function writeReenrollGrant(grant: PersistedReenrollGrant): void {
    writeReenrollGrantPending(grant)
    commitReenrollGrant()
}

/**
 * Prefer a staged pending grant (post-ack / pre-rename), else the durable file.
 * Do not discard on local expiry — hub verify is authoritative (#1473 Major).
 */
export function readReenrollGrant(): PersistedReenrollGrant | null {
    for (const path of [pendingGrantPath(), grantPath()]) {
        if (!existsSync(path)) {
            continue
        }
        try {
            const parsed = parseGrant(readFileSync(path, 'utf8'))
            if (parsed) {
                return parsed
            }
        } catch {
            // try next
        }
    }
    return null
}

export function clearReenrollGrant(): void {
    for (const path of [pendingGrantPath(), grantPath()]) {
        if (existsSync(path)) {
            try {
                unlinkSync(path)
            } catch {
                // ignore
            }
        }
    }
}
