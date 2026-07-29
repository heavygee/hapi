import packageJson from '../../package.json'
import { isBunCompiled } from '@/projectPath'
import { logger } from '@/ui/logger'
import { getCliArgs } from '@/utils/cliArgs'
import { ensureLoopbackProxyBypass } from '@/utils/proxyEnv'
import { resolveCommand } from './registry'
import {
    readUpgradeTarget,
    shouldDelegateToUpgradeTarget,
} from '@/upgrade/upgradeTarget'
import { spawnSync } from 'node:child_process'

export async function runCli(): Promise<void> {
    ensureLoopbackProxyBypass()

    // Supervised hosts (systemd Restart=always) relaunch the old ExecStart after
    // a hub-artifact handoff. Re-exec into the durable upgrade target first.
    const upgradeTarget = readUpgradeTarget()
    if (upgradeTarget && shouldDelegateToUpgradeTarget(upgradeTarget)) {
        const args = getCliArgs()
        const result = spawnSync(upgradeTarget.path, args, {
            stdio: 'inherit',
            env: {
                ...process.env,
                HAPI_CLI_EXECUTABLE: upgradeTarget.path,
            },
        })
        process.exit(result.status ?? 1)
    }

    const args = getCliArgs()

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
