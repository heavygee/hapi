import { randomUUID } from 'node:crypto'
import { configuration } from '@/configuration'
import { updateSettings } from '@/persistence'

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

