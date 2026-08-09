import { randomUUID } from 'node:crypto'
import { configuration } from '@/configuration'
import { updateSettings } from '@/persistence'

/** Hub 409 body when a pre-tag machine row cannot be first-claim bound (#1473). */
export const LEGACY_MACHINE_REENROLL_MESSAGE =
    'Legacy machine must be re-enrolled with a new machine id'

export async function authAndSetupMachineIfNeeded(): Promise<{
    token: string
    machineId: string
    machineTag: string
}> {
    if (!configuration.cliApiToken) {
        throw new Error('CLI_API_TOKEN is required')
    }

    const settings = await updateSettings((current) => {
        let next = current
        if (!current.machineId) {
            next = { ...next, machineId: randomUUID() }
        }
        if (!current.machineTag?.trim()) {
            next = { ...next, machineTag: randomUUID() }
        }
        return next
    })

    if (!settings.machineId) {
        throw new Error('Failed to initialize machineId')
    }
    if (!settings.machineTag?.trim()) {
        throw new Error('Failed to initialize machineTag')
    }

    return {
        token: configuration.cliApiToken,
        machineId: settings.machineId,
        machineTag: settings.machineTag.trim(),
    }
}

/**
 * Mint a new machine id after hub refuses legacy tag bind.
 * Idempotent across processes: if settings already left `expectedMachineId`,
 * reuse the rotated identity instead of minting a second one (#1473 Major).
 */
export async function rotateMachineIdForLegacyReenroll(expectedMachineId: string): Promise<{
    machineId: string
    machineTag: string
}> {
    const rejectedId = expectedMachineId.trim()
    const settings = await updateSettings((current) => {
        if (current.machineId && rejectedId && current.machineId !== rejectedId) {
            return current
        }
        const machineTag = current.machineTag?.trim() || randomUUID()
        const previousMachineIds = [
            ...new Set([
                ...(current.previousMachineIds ?? []),
                ...(rejectedId ? [rejectedId] : []),
            ]),
        ]
        return {
            ...current,
            machineId: randomUUID(),
            machineTag,
            previousMachineIds,
        }
    })
    if (!settings.machineId || !settings.machineTag?.trim()) {
        throw new Error('Failed to rotate machine identity for legacy re-enroll')
    }
    return {
        machineId: settings.machineId,
        machineTag: settings.machineTag.trim(),
    }
}

