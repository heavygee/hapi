/**
 * Durable hub-artifact upgrade target.
 *
 * After a fleet upgrade installs a content-addressed binary under ~/.hapi/bin,
 * systemd (Restart=always, ExecStart=/usr/local/bin/hapi) can relaunch the old
 * entrypoint. Reading this marker early in runCli re-execs into the upgraded
 * binary so the handoff survives supervisor restarts.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { configuration } from '@/configuration'
import { isBunCompiled } from '@/projectPath'
import { resolveHappyCliExecutable } from '@/utils/spawnHappyCLI'

export type UpgradeTarget = {
    path: string
    targetVersion: string
    targetCapabilities?: string[]
    updatedAt: number
}

export function upgradeTargetMarkerPath(): string {
    const base = markerBaseDirOverride
        ?? configuration.happyHomeDir
        ?? join(homedir(), '.hapi')
    return join(base, 'bin', '.hapi-upgrade-target')
}

/** Test-only override so markers land in a temp dir without reloading configuration. */
let markerBaseDirOverride: string | null = null
export function __setUpgradeTargetBaseDirForTests(dir: string | null): void {
    markerBaseDirOverride = dir
}

export function writeUpgradeTarget(target: Omit<UpgradeTarget, 'updatedAt'> & { updatedAt?: number }): void {
    const marker = upgradeTargetMarkerPath()
    mkdirSync(dirname(marker), { recursive: true })
    const payload: UpgradeTarget = {
        path: target.path,
        targetVersion: target.targetVersion,
        targetCapabilities: target.targetCapabilities,
        updatedAt: target.updatedAt ?? Date.now(),
    }
    writeFileSync(marker, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export function readUpgradeTarget(): UpgradeTarget | null {
    const marker = upgradeTargetMarkerPath()
    if (!existsSync(marker)) {
        return null
    }
    try {
        const raw = readFileSync(marker, 'utf8').trim()
        if (!raw) {
            return null
        }
        // Legacy: plain path string from earlier builds.
        if (!raw.startsWith('{')) {
            return {
                path: raw,
                targetVersion: '',
                updatedAt: 0,
            }
        }
        const parsed = JSON.parse(raw) as Partial<UpgradeTarget>
        if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
            return null
        }
        return {
            path: parsed.path,
            targetVersion: typeof parsed.targetVersion === 'string' ? parsed.targetVersion : '',
            targetCapabilities: Array.isArray(parsed.targetCapabilities)
                ? parsed.targetCapabilities.filter((cap): cap is string => typeof cap === 'string')
                : undefined,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        }
    } catch {
        return null
    }
}

function samePath(left: string, right: string): boolean {
    try {
        return realpathSync(left) === realpathSync(right)
    } catch {
        return left === right
    }
}

/**
 * True when this process should re-exec into the upgrade-target binary.
 * Skip for plain source `bun run` unless HAPI_CLI_EXECUTABLE is already set —
 * developers should not be silently redirected into a compiled soup artifact.
 */
export function shouldDelegateToUpgradeTarget(target: UpgradeTarget): boolean {
    if (!target.path || !existsSync(target.path)) {
        return false
    }
    if (!isBunCompiled() && !process.env.HAPI_CLI_EXECUTABLE?.trim()) {
        return false
    }
    const current = resolveHappyCliExecutable()
    return !samePath(current, target.path)
}
