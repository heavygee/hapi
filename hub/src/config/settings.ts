import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FleetUpgradePolicy } from '@hapi/protocol/upgradeChannel'

export interface Settings {
    machineId?: string
    machineIdConfirmedByServer?: boolean
    runnerAutoStartWhenRunningHappy?: boolean
    cliApiToken?: string
    vapidKeys?: {
        publicKey: string
        privateKey: string
    }
    // Server configuration (persisted from environment variables)
    telegramBotToken?: string
    telegramNotification?: boolean
    serverChanSendKey?: string
    serverChanNotification?: boolean
    listenHost?: string
    listenPort?: number
    publicUrl?: string
    corsOrigins?: string[]
    /** Opt-in GitHub PR awareness for sessions. Default off. */
    githubPrAwareness?: boolean
    // Operator fleet-upgrade policy (no alert / alert / auto-upgrade)
    fleetUpgradePolicy?: FleetUpgradePolicy
    /** Per-hub relay auth key issued by the relay server (/issue) */
    relayAuthKey?: string
    /**
     * Hub-side provider API keys / endpoints managed from Settings.
     * Env vars still win when set at process start (ops override).
     */
    providerCredentials?: Partial<Record<string, string>>
}

export function getSettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.json')
}

/**
 * Read settings from file, preserving all existing fields.
 * Returns null if file exists but cannot be parsed (to avoid data loss).
 */
export async function readSettings(settingsFile: string): Promise<Settings | null> {
    if (!existsSync(settingsFile)) {
        return {}
    }
    try {
        const content = await readFile(settingsFile, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        // Return null to signal parse error - caller should not overwrite
        console.error(`[WARN] Failed to parse ${settingsFile}: ${error}`)
        return null
    }
}

export async function readSettingsOrThrow(settingsFile: string): Promise<Settings> {
    const settings = await readSettings(settingsFile)
    if (settings === null) {
        throw new Error(
            `Cannot read ${settingsFile}. Please fix or remove the file and restart.`
        )
    }
    return settings
}

/**
 * Write settings to file atomically (temp file + rename)
 */
export async function writeSettings(settingsFile: string, settings: Settings): Promise<void> {
    const dir = dirname(settingsFile)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }

    const tmpFile = settingsFile + '.tmp'
    await writeFile(tmpFile, JSON.stringify(settings, null, 2))
    await rename(tmpFile, settingsFile)
}

/** Process-wide queue so concurrent RMW writers share one settings.json + .tmp. */
let settingsWriteTail: Promise<void> = Promise.resolve()

/**
 * Read-modify-write settings under a process-wide serial queue.
 * Use this for any runtime writer (fleet policy, relay auth, …).
 */
export async function updateSettingsFile(
    settingsFile: string,
    mutate: (settings: Settings) => void,
): Promise<Settings> {
    const task = settingsWriteTail.then(async () => {
        const settings = await readSettings(settingsFile)
        if (settings === null) {
            throw new Error(
                `Cannot read ${settingsFile}; fix or remove it before updating settings`,
            )
        }
        mutate(settings)
        await writeSettings(settingsFile, settings)
        return settings
    })
    // Keep the chain alive after failures so later writers still serialize.
    settingsWriteTail = task.then(
        () => undefined,
        () => undefined,
    )
    return task
}

/** Test-only: reset the settings write queue between suites. */
export function resetSettingsWriteQueueForTests(): void {
    settingsWriteTail = Promise.resolve()
}
