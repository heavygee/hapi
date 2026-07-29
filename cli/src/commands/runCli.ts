import packageJson from '../../package.json'
import { isBunCompiled } from '@/projectPath'
import { logger } from '@/ui/logger'
import { getCliArgs } from '@/utils/cliArgs'
import { ensureLoopbackProxyBypass } from '@/utils/proxyEnv'
import { resolveCommand } from './registry'
import {
    clearUpgradeTarget,
    isAuthorizedRunnerHandoff,
    isRunnerStartCliArgs,
    readUpgradeTarget,
    shouldDelegateToUpgradeTarget,
} from '@/upgrade/upgradeTarget'
import { spawn, type ChildProcess } from 'node:child_process'

/** Wait for delegated child exit; reject on spawn error so caller can clear the marker. */
export function waitForDelegatedRunner(child: ChildProcess): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (status, signal) => {
            if (signal) {
                resolve(1)
                return
            }
            resolve(status ?? 1)
        })
    })
}

export async function runCli(): Promise<void> {
    ensureLoopbackProxyBypass()

    const args = getCliArgs()

    // Hub-artifact binaries are runner-only (empty embedded web). Only redirect
    // systemd `runner start` / `start-sync` so `hapi hub` / doctor stay on the
    // general-purpose entrypoint.
    // Spawn (not spawnSync) and forward SIGTERM/SIGINT so KillMode=process still
    // stops the upgraded runner when systemd signals the wrapper PID.
    // During an authorized handoff the child is already the candidate binary —
    // do not bounce it back to a previous durable marker target.
    const upgradeTarget = !isAuthorizedRunnerHandoff() && isRunnerStartCliArgs(args)
        ? readUpgradeTarget()
        : null
    if (upgradeTarget && shouldDelegateToUpgradeTarget(upgradeTarget)) {
        // Unix: new process group so SIGTERM under KillMode=process reaches the
        // npm shim AND its execFileSync grandchild runner, not just the shim PID.
        const useProcessGroup = process.platform !== 'win32'
        const child = spawn(upgradeTarget.path, args, {
            stdio: 'inherit',
            env: {
                ...process.env,
                HAPI_CLI_EXECUTABLE: upgradeTarget.path,
            },
            shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(upgradeTarget.path),
            detached: useProcessGroup,
        })
        const forward = (signal: NodeJS.Signals): void => {
            try {
                if (useProcessGroup && child.pid) {
                    process.kill(-child.pid, signal)
                } else {
                    child.kill(signal)
                }
            } catch {
                // child may already be gone
            }
        }
        process.once('SIGTERM', forward)
        process.once('SIGINT', forward)
        try {
            const code = await waitForDelegatedRunner(child)
            process.exit(code)
        } catch (error) {
            clearUpgradeTarget()
            logger.debug('[UPGRADE] Durable target failed to spawn; using current CLI', error)
            // Fall through to the current CLI's normal command dispatch.
        }
    }

    if (args.includes('-v') || args.includes('--version')) {
        console.log(`hapi version: ${packageJson.version}`)
        process.exit(0)
    }

    if (isBunCompiled()) {
        process.env.DEV = 'false'
    }

    const { command, context } = resolveCommand(args)

    if (command.requiresRuntimeAssets) {
        const { ensureRuntimeAssets } = await import('@/runtime/assets')
        await ensureRuntimeAssets()
        logger.debug('Starting hapi CLI with args: ', process.argv)
    }

    await command.run(context)
}
