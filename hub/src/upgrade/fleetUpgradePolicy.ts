/**
 * Fleet-upgrade policy: hub default + optional per-machine overrides.
 *
 * Hub default (Settings) is silent/alert/auto for banner UX and as the
 * fallback when a machine has no override. Hub-wide `auto` does **not**
 * keepalive-apply (deliberate push only — #247 tip thrash). Per-machine
 * `auto` means "apply when you can": keepalive / machine-updated retry once
 * the live self-upgrade RPC is registered, plus deliberate push.
 */
import {
    DEFAULT_FLEET_UPGRADE_POLICY,
    isFleetUpgradePolicy,
    type FleetUpgradePolicy,
} from '@hapi/protocol/upgradeChannel'
import { getSettingsFile, updateSettings } from '../config/settings'

let cachedPolicy: FleetUpgradePolicy = DEFAULT_FLEET_UPGRADE_POLICY
let cachedMachinePolicies: Record<string, FleetUpgradePolicy> = {}
let dataDir: string | null = null

export function normalizeMachinePolicies(raw: unknown): Record<string, FleetUpgradePolicy> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {}
    }
    const out: Record<string, FleetUpgradePolicy> = {}
    for (const [machineId, policy] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof machineId === 'string' && machineId.length > 0 && isFleetUpgradePolicy(policy)) {
            out[machineId] = policy
        }
    }
    return out
}

/** Seed the cache from persisted settings on hub startup. */
export function initFleetUpgradePolicy(options: {
    dataDir: string
    persisted?: unknown
    persistedMachinePolicies?: unknown
}): void {
    dataDir = options.dataDir
    cachedPolicy = isFleetUpgradePolicy(options.persisted)
        ? options.persisted
        : DEFAULT_FLEET_UPGRADE_POLICY
    cachedMachinePolicies = normalizeMachinePolicies(options.persistedMachinePolicies)
}

export function getFleetUpgradePolicy(): FleetUpgradePolicy {
    return cachedPolicy
}

export function getFleetUpgradeMachinePolicies(): Record<string, FleetUpgradePolicy> {
    return { ...cachedMachinePolicies }
}

/** Effective policy for one machine: override if set, else hub default. */
export function getEffectiveFleetUpgradePolicy(machineId: string): FleetUpgradePolicy {
    return cachedMachinePolicies[machineId] ?? cachedPolicy
}

/** Update the hub-default cache and persist to settings.json. */
export async function setFleetUpgradePolicy(policy: FleetUpgradePolicy): Promise<void> {
    if (!dataDir) {
        cachedPolicy = policy
        return
    }
    const file = getSettingsFile(dataDir)
    await updateSettings(file, (settings) => ({
        settings: { ...settings, fleetUpgradePolicy: policy },
        result: undefined,
    }))
    cachedPolicy = policy
}

/** Set or clear a per-machine override (`null` removes the override). */
export async function setFleetUpgradeMachinePolicy(
    machineId: string,
    policy: FleetUpgradePolicy | null,
): Promise<Record<string, FleetUpgradePolicy>> {
    const id = machineId.trim()
    if (!id) {
        throw new Error('machineId required')
    }
    const next = { ...cachedMachinePolicies }
    if (policy === null) {
        delete next[id]
    } else {
        next[id] = policy
    }
    if (!dataDir) {
        cachedMachinePolicies = next
        return { ...cachedMachinePolicies }
    }
    const file = getSettingsFile(dataDir)
    await updateSettings(file, (settings) => ({
        settings: {
            ...settings,
            fleetUpgradeMachinePolicies: Object.keys(next).length > 0 ? next : undefined,
        },
        result: undefined,
    }))
    cachedMachinePolicies = next
    return { ...cachedMachinePolicies }
}

/** Test-only reset so suites don't leak cached state across cases. */
export function resetFleetUpgradePolicyForTests(): void {
    cachedPolicy = DEFAULT_FLEET_UPGRADE_POLICY
    cachedMachinePolicies = {}
    dataDir = null
}
