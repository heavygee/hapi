import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
    githubPrChipStatusFromEmoji,
    type GithubPrChipStatusFields
} from './externalRefs'

const execFileAsync = promisify(execFile)

export type RunPrEmojiBatchExec = (
    file: string,
    args: string[],
    opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>

function pathExists(path: string): boolean {
    try {
        accessSync(path, constants.X_OK)
        return true
    } catch {
        try {
            accessSync(path, constants.F_OK)
            return true
        } catch {
            return false
        }
    }
}

/** Resolve Meta's hapi-pr-emoji-batch.sh (same precedence spirit as pec_resolve_tool). */
export function resolvePrEmojiBatchBin(
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string | null {
    const injected = env.HAPI_META_BATCH_BIN?.trim()
    if (injected && pathExists(injected)) {
        return injected
    }
    const primary = (env.HAPI_PRIMARY ?? join(home, 'coding/hapi')).replace(/\/$/, '')
    const candidates = [
        join(primary, 'scripts/tooling/hapi-pr-emoji-batch.sh'),
        join(home, 'coding/hapi/scripts/tooling/hapi-pr-emoji-batch.sh')
    ]
    for (const candidate of candidates) {
        if (pathExists(candidate)) {
            return candidate
        }
    }
    return null
}

/**
 * Run Meta's PR classifier for one PR and map to chip status fields.
 * Returns null when gh/batch unavailable or emoji is `?` (do not stomp last-good).
 */
export async function classifyGithubPrChipStatus(
    repo: string,
    number: number,
    opts: {
        env?: NodeJS.ProcessEnv
        timeoutMs?: number
        exec?: RunPrEmojiBatchExec
        nowMs?: number
        batchBin?: string | null
    } = {}
): Promise<GithubPrChipStatusFields | null> {
    const env = opts.env ?? process.env
    const batchBin = opts.batchBin === undefined
        ? resolvePrEmojiBatchBin(env)
        : opts.batchBin
    if (!batchBin) {
        return null
    }

    const exec = opts.exec ?? ((file, args, execOpts) => execFileAsync(file, args, execOpts))
    const timeoutMs = opts.timeoutMs ?? 45_000
    let stdout: string
    try {
        const result = await exec(batchBin, ['--repo', repo, String(number)], {
            timeout: timeoutMs,
            env: {
                ...env,
                NO_COLOR: '1',
                CLICOLOR: '0',
                HAPI_AGENT_CONTEXT: '1'
            },
            maxBuffer: 2 * 1024 * 1024
        })
        stdout = result.stdout
    } catch {
        return null
    }

    const line = stdout.trim().split('\n').filter(Boolean).at(-1)
    if (!line) {
        return null
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(line)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') {
        return null
    }
    const entry = (parsed as Record<string, unknown>)[String(number)]
    if (!entry || typeof entry !== 'object') {
        return null
    }
    const emoji = typeof (entry as { emoji?: unknown }).emoji === 'string'
        ? (entry as { emoji: string }).emoji
        : ''
    const action = typeof (entry as { action?: unknown }).action === 'string'
        ? (entry as { action: string }).action
        : ''
    return githubPrChipStatusFromEmoji(emoji, action, opts.nowMs ?? Date.now())
}
