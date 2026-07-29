import packageJson from '../../package.json'
import { isBunCompiled } from '@/projectPath'
import { logger } from '@/ui/logger'
import { getCliArgs } from '@/utils/cliArgs'
import { ensureLoopbackProxyBypass } from '@/utils/proxyEnv'
import { resolveCommand } from './registry'
import {
    isRunnerStartCliArgs,
    readUpgradeTarget,
    shouldDelegateToUpgradeTarget,
} from '@/upgrade/upgradeTarget'
import { spawn } from 'node:child_process'

export async function runCli(): Promise<void> {
    ensureLoopbackProxyBypass()

    const args = getCliArgs()

    // Hub-artifact binaries are runner-only (empty embedded web). Only redirect
    // systemd `runner start` / `start-sync` so `hapi hub` / doctor stay on the
    // general-purpose entrypoint.
    // Spawn (not spawnSync) and forward SIGTERM/SIGINT so KillMode=process still
    // stops the upgraded runner when systemd signals the wrapper PID.
    const upgradeTarget = isRunnerStartCliArgs(args) ? readUpgradeTarget() : null
    if (upgradeTarget && shouldDelegateToUpgradeTarget(upgradeTarget)) {
        const child = spawn(upgradeTarget.path, args, {
            stdio: 'inherit',
            env: {
                ...process.env,
                HAPI_CLI_EXECUTABLE: upgradeTarget.path,
            },
            shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(upgradeTarget.path),
        })
        const forward = (signal: NodeJS.Signals): void => {
            try {
                child.kill(signal)
            } catch {
                // child may already be gone
            }
        }
        process.once('SIGTERM', forward)
        process.once('SIGINT', forward)
        const code = await new Promise<number>((resolve, reject) => {
            child.once('error', reject)
            child.once('exit', (status, signal) => {
                if (signal) {
                    resolve(1)
                    return
                }
                resolve(status ?? 1)
            })
        })
        process.exit(code)
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
