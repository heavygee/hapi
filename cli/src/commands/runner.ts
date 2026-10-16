import chalk from 'chalk'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { readRunnerState } from '@/persistence'
import { startRunner } from '@/runner/run'
import {
    checkIfRunnerRunningAndCleanupStaleState,
    listRunnerSessions,
    stopRunner,
    stopRunnerSession
} from '@/runner/controlClient'
import { getLatestRunnerLog } from '@/ui/logger'
import { getHapiRunnerProcessIdentity, isProcessAlive, killProcessTreeByPid } from '@/utils/process'
import { spawnHappyCLI } from '@/utils/spawnHappyCLI'
import { runDoctorCommand } from '@/ui/doctor'
import { initializeToken } from '@/ui/tokenInit'
import type { CommandDefinition } from './types'

/**
 * Parent `runner start` must not declare success until hub registration wrote hubReadyAt.
 *
 * On Windows, `HAPI_CLI_EXECUTABLE=hapi.cmd` makes `childPid` the cmd.exe wrapper
 * while runner.state.json stores the binary grandchild. A different live PID
 * with hubReadyAt is the same success the handoff helper already accepts.
 */
export function detachedRunnerHubReady(
    state: { pid?: number; hubReadyAt?: number } | null | undefined,
    childPid: number | undefined,
    stateIdentity: (pid: number) => 'runner' | 'foreign' | 'unknown' | 'dead' = getHapiRunnerProcessIdentity,
): boolean {
    if (typeof state?.hubReadyAt !== 'number' || state.hubReadyAt <= 0) {
        return false
    }
    if (typeof state.pid !== 'number' || !isProcessAlive(state.pid)) {
        return false
    }
    if (typeof childPid === 'number' && state.pid === childPid) {
        return true
    }
    // A reused pid can be alive and still carry an old hubReadyAt. Only a
    // confirmed hapi runner, or the process we just spawned, counts.
    return stateIdentity(state.pid) === 'runner'
}

/** Wrapper and Windows grandchild to stop when hub registration never finishes. */
export function runnerStartTimeoutPids(
    childPid: number | undefined,
    statePid: number | undefined,
    isAlive: (pid: number) => boolean = isProcessAlive,
    stateIdentity: (pid: number) => 'runner' | 'foreign' | 'unknown' | 'dead' = getHapiRunnerProcessIdentity,
): number[] {
    const pids: number[] = []
    if (typeof childPid === 'number' && isAlive(childPid)) {
        pids.push(childPid)
    }
    // A stale state file can name an unrelated live PID. Only the wrapper we
    // spawned, or a process that is actually a hapi runner, may be killed.
    if (
        typeof statePid === 'number'
        && statePid !== childPid
        && isAlive(statePid)
        && stateIdentity(statePid) === 'runner'
    ) {
        pids.push(statePid)
    }
    return pids
}

/**
 * Parses repeated `--workspace-root <path>` / `--workspace-root=<path>` from
 * the runner's positional args. Returns resolved absolute paths or exits
 * the process with a clear error. Mutates `args` to remove the consumed
 * entries so subcommand dispatch still works.
 */
function extractWorkspaceRootArgs(args: string[]): string[] | undefined {
    const workspaceRoots: string[] = []

    for (let i = 0; i < args.length;) {
        const arg = args[i]
        let value: string | undefined
        let consumed = 0
        if (arg === '--workspace-root') {
            const next = args[i + 1]
            if (next === undefined || next.startsWith('--')) {
                console.error('--workspace-root requires a path argument')
                process.exit(1)
            }
            value = next
            consumed = 2
        } else if (arg?.startsWith('--workspace-root=')) {
            value = arg.slice('--workspace-root='.length)
            consumed = 1
        }
        if (value === undefined) {
            i += 1
            continue
        }

        const trimmed = value.trim()
        if (!trimmed) {
            console.error('--workspace-root requires a non-empty path')
            process.exit(1)
        }
        // Handle `~` / `~/foo` since the shell only expands unquoted tildes.
        let expanded = trimmed
        if (expanded === '~') {
            expanded = homedir()
        } else if (expanded.startsWith('~/')) {
            expanded = resolve(homedir(), expanded.slice(2))
        }
        const absolute = isAbsolute(expanded) ? expanded : resolve(expanded)
        if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
            console.error(`--workspace-root path does not exist or is not a directory: ${absolute}`)
            process.exit(1)
        }
        workspaceRoots.push(absolute)
        args.splice(i, consumed)
    }

    const uniqueWorkspaceRoots = Array.from(new Set(workspaceRoots))
    return uniqueWorkspaceRoots.length > 0 ? uniqueWorkspaceRoots : undefined
}

async function waitForRunnerToStop(maxAttempts = 50): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        if (!(await checkIfRunnerRunningAndCleanupStaleState())) {
            return true
        }
        await new Promise(resolve => setTimeout(resolve, 100))
    }

    return false
}

export const runnerCommand: CommandDefinition = {
    name: 'runner',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        const mutableArgs = [...commandArgs]
        const workspaceRoots = extractWorkspaceRootArgs(mutableArgs)
        const runnerSubcommand = mutableArgs[0]

        if (runnerSubcommand === 'list') {
            try {
                const sessions = await listRunnerSessions()

                if (sessions.length === 0) {
                    console.log('No active sessions this runner is aware of (they might have been started by a previous version of the runner)')
                } else {
                    console.log('Active sessions:')
                    console.log(JSON.stringify(sessions, null, 2))
                }
            } catch {
                console.log('No runner running')
            }
            return
        }

        if (runnerSubcommand === 'stop-session') {
            const sessionId = mutableArgs[1]
            if (!sessionId) {
                console.error('Session ID required')
                process.exit(1)
            }

            try {
                const status = await stopRunnerSession(sessionId)
                if (status === 'stopped') {
                    console.log('Session stopped')
                } else if (status === 'already_gone') {
                    console.log('Session was already stopped')
                } else {
                    console.log('Failed to stop session')
                }
            } catch {
                console.log('No runner running')
            }
            return
        }

        if (runnerSubcommand === 'start') {
            if (await checkIfRunnerRunningAndCleanupStaleState()) {
                console.log('Existing runner detected, stopping it before starting a new one...')
                await stopRunner()

                if (!(await waitForRunnerToStop())) {
                    console.error('Failed to stop existing runner')
                    process.exit(1)
                }
            }

            const childArgs = ['runner', 'start-sync']
            if (workspaceRoots?.length) {
                for (const workspaceRoot of workspaceRoots) {
                    childArgs.push('--workspace-root', workspaceRoot)
                }
            }
            const child = spawnHappyCLI(childArgs, {
                detached: true,
                stdio: 'ignore',
                env: process.env
            })
            child.unref()

            // One POST /cli/machines attempt can sit on a 60s timeout. Wait
            // past that, then kill the child so a late success cannot outlive
            // the failure we print (#288).
            const readyWaitMs = 150_000
            const pollMs = 100
            let started = false
            const deadline = Date.now() + readyWaitMs
            while (Date.now() < deadline) {
                const state = await readRunnerState()
                if (detachedRunnerHubReady(state, child.pid)) {
                    started = true
                    break
                }
                const wrapperAlive = typeof child.pid === 'number' && isProcessAlive(child.pid)
                const replacementAlive = typeof state?.pid === 'number'
                    && state.pid !== child.pid
                    && isProcessAlive(state.pid)
                if (!wrapperAlive && !replacementAlive) {
                    break
                }
                await new Promise(resolve => setTimeout(resolve, pollMs))
            }

            if (!started) {
                const state = await readRunnerState()
                for (const pid of runnerStartTimeoutPids(child.pid, state?.pid)) {
                    await killProcessTreeByPid(pid, true)
                }
            }

            if (started) {
                console.log('Runner started successfully')
            } else {
                console.error('Failed to start runner (hub registration did not complete)')
                process.exit(1)
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'start-sync') {
            await initializeToken()
            await startRunner({ workspaceRoots })
            process.exit(0)
        }

        if (runnerSubcommand === 'stop') {
            await stopRunner()
            process.exit(0)
        }

        if (runnerSubcommand === 'status') {
            await runDoctorCommand('runner')
            process.exit(0)
        }

        if (runnerSubcommand === 'logs') {
            const latest = await getLatestRunnerLog()
            if (!latest) {
                console.log('No runner logs found')
            } else {
                console.log(latest.path)
            }
            process.exit(0)
        }

        console.log(`
${chalk.bold('hapi runner')} - Runner management

${chalk.bold('Usage:')}
  hapi runner start              Start the runner (replaces existing runner)
  hapi runner stop               Stop the runner (sessions stay alive)
  hapi runner status             Show runner status
  hapi runner list               List active sessions

${chalk.bold('Options:')}
  --workspace-root <path>        Restrict the runner to this directory.
                                 Repeat to allow multiple directories/drives.
                                 Browse & spawn reject paths outside them.
                                 Supports \`~\` / \`~/foo\` expansion.
                                 Omit to leave browsing off (legacy mode).

  If you want to kill all hapi related processes run 
  ${chalk.cyan('hapi doctor clean')}

${chalk.bold('Note:')} The runner runs in the background and manages Claude sessions.
Running ${chalk.cyan('hapi runner start')} stops any existing runner first so new flags and environment variables take effect.

${chalk.bold('To clean up runaway processes:')} Use ${chalk.cyan('hapi doctor clean')}
`)
    }
}
