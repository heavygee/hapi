import { existsSync, readFileSync, unlinkSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
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

/** Persist a short-lived hub reenroll grant across graceful runner restart (#1473). */
export function writeReenrollGrant(grant: PersistedReenrollGrant): void {
    const path = grantPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify(grant), { mode: 0o600 })
    chmodSync(path, 0o600)
}

export function readReenrollGrant(): PersistedReenrollGrant | null {
    const path = grantPath()
    if (!existsSync(path)) {
        return null
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedReenrollGrant
        if (
            typeof parsed.fromMachineId !== 'string'
            || typeof parsed.machineTag !== 'string'
            || typeof parsed.grant !== 'string'
            || typeof parsed.expiresAt !== 'number'
        ) {
            return null
        }
        if (parsed.expiresAt < Date.now()) {
            clearReenrollGrant()
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

export function clearReenrollGrant(): void {
    const path = grantPath()
    if (existsSync(path)) {
        try {
            unlinkSync(path)
        } catch {
            // ignore
        }
    }
}
