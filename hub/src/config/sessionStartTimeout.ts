import { clampSessionStartTimeoutMs } from '@hapi/protocol'
import { getConfiguration } from '../configuration'
import { readSettings } from './settings'

/**
 * Session-start timeout the hub hands to a runner with each spawn
 * (tiann/hapi#2062).
 *
 * Read from settings.json per spawn rather than cached at boot, so saving the
 * value in Settings applies to the very next session without a hub restart.
 * Returns null when unset or unreadable — the runner then uses its own
 * env/default, which is also what happens for every runner on an older hub.
 */
export async function readSessionStartTimeoutMs(settingsFile: string): Promise<number | null> {
    try {
        const settings = await readSettings(settingsFile)
        return clampSessionStartTimeoutMs(settings?.sessionStartTimeoutMs)
    } catch {
        return null
    }
}

export async function getConfiguredSessionStartTimeoutMs(): Promise<number | null> {
    let settingsFile: string
    try {
        settingsFile = getConfiguration().settingsFile
    } catch {
        // Configuration not initialised (unit tests, early boot).
        return null
    }
    return readSessionStartTimeoutMs(settingsFile)
}
