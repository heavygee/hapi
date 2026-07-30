/**
 * Runtime holder for the hub-global fleet-upgrade policy (the 3-pole
 * "no alert / alert / auto-upgrade" switch). Cached in memory so the sync
 * engine and web routes read it synchronously, and persisted to the hub
 * settings.json so it survives restarts ("set and forget").
 */
import {
    DEFAULT_FLEET_UPGRADE_POLICY,
    isFleetUpgradePolicy,
    type FleetUpgradePolicy,
} from '@hapi/protocol/upgradeChannel'
import { getSettingsFile, readSettings, writeSettings } from '../config/settings'

let cachedPolicy: FleetUpgradePolicy = DEFAULT_FLEET_UPGRADE_POLICY
let dataDir: string | null = null

/** Seed the cache from persisted settings on hub startup. */
export function initFleetUpgradePolicy(options: { dataDir: string; persisted?: unknown }): void {
    dataDir = options.dataDir
    cachedPolicy = isFleetUpgradePolicy(options.persisted)
        ? options.persisted
        : DEFAULT_FLEET_UPGRADE_POLICY
}

export function getFleetUpgradePolicy(): FleetUpgradePolicy {
    return cachedPolicy
}

/** Update the cache and persist to settings.json (best-effort atomic write). */
export async function setFleetUpgradePolicy(policy: FleetUpgradePolicy): Promise<void> {
    if (!dataDir) {
        cachedPolicy = policy
        return
    }
    const file = getSettingsFile(dataDir)
    const settings = await readSettings(file)
    // readSettings returns null on parse errors to avoid clobbering a recoverable
    // settings.json. Refuse the write rather than replacing the file with {}.
    if (settings === null) {
        throw new Error(`Cannot read ${file}; fix or remove it before updating fleet upgrade policy`)
    }
    settings.fleetUpgradePolicy = policy
    await writeSettings(file, settings)
    cachedPolicy = policy
}

/** Test-only reset so suites don't leak cached state across cases. */
export function resetFleetUpgradePolicyForTests(): void {
    cachedPolicy = DEFAULT_FLEET_UPGRADE_POLICY
    dataDir = null
}
