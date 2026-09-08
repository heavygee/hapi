import fs from 'node:fs/promises'
import os, { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

import type { AgentFlavor } from '@hapi/protocol'

import { readSettings } from '@/persistence'

/**
 * A directory-scoped authentication profile, configured by the operator in
 * `~/.hapi/settings.json`:
 *
 * ```json
 * {
 *   "directoryAuthProfiles": [
 *     { "pathPrefix": "~/coding/sparling", "claudeCodeOAuthToken": "sk-ant-oat01-..." }
 *   ]
 * }
 * ```
 *
 * Sessions spawned at (or below) `pathPrefix` run Claude under that token
 * instead of whatever account the runner host happens to be logged into.
 * This lets one machine host work for two billing accounts — e.g. an ambient
 * personal login plus a client/Teams account bound to a single project tree —
 * without the operator re-authenticating between sessions.
 *
 * Claude only for now: Codex's `CODEX_HOME` variant is deliberately not
 * covered, so the field name says which credential it carries.
 */
export interface DirectoryAuthProfile {
    pathPrefix: string
    claudeCodeOAuthToken: string
}

/**
 * Absolute, separator-normalized form of a path, or `null` when the value is
 * unusable as a prefix/target. Relative paths are rejected rather than
 * resolved against `process.cwd()`: the runner's cwd has nothing to do with
 * where a session is spawned, so resolving against it would silently bind a
 * token to an unrelated tree. Failing closed here just falls back to the
 * ambient environment.
 */
function normalizeDirectory(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }
    // `~` is expanded because settings.json is hand-edited.
    const expanded = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith(`~${sep}`)
        ? join(homedir(), trimmed.slice(1))
        : trimmed
    if (!isAbsolute(expanded)) {
        return null
    }
    const resolved = resolve(expanded)
    return resolved.length > 1 && resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved
}

/** Windows paths are case-insensitive; POSIX paths are not. */
function comparable(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Segment-aware containment: `/a/b` contains `/a/b` and `/a/b/c`, but NOT
 * `/a/b-old`. A naive `startsWith` would hand a sibling directory someone
 * else's credentials.
 *
 * Paths are compared literally - symlinks are not resolved, so a profile is
 * matched against the path the session was opened at, not its physical
 * target. A symlinked project that should carry a profile needs its real
 * path (or the link's own path) configured.
 */
function isWithinPrefix(target: string, prefix: string): boolean {
    const t = comparable(target)
    const p = comparable(prefix)
    if (t === p) {
        return true
    }
    return t.startsWith(p.endsWith(sep) ? p : p + sep)
}

/**
 * Longest-prefix match of `directory` against `profiles`, so a nested profile
 * (`/repos/acme/secret-client`) beats the tree-wide one (`/repos`).
 * Returns `undefined` when nothing matches or nothing is configured, in which
 * case the caller must leave the spawn environment untouched.
 *
 * Entries are validated defensively: `settings.json` is parsed as free-form
 * JSON, so a malformed entry must be skipped rather than crash a spawn.
 */
export function resolveDirectoryAuthToken(
    directory: string,
    profiles: DirectoryAuthProfile[] | undefined
): string | undefined {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        return undefined
    }
    const target = normalizeDirectory(directory)
    if (!target) {
        return undefined
    }

    let best: { prefix: string; token: string } | undefined
    for (const profile of profiles) {
        if (!profile || typeof profile !== 'object') {
            continue
        }
        const token = profile.claudeCodeOAuthToken
        if (typeof token !== 'string' || !token) {
            continue
        }
        const prefix = normalizeDirectory(profile.pathPrefix)
        if (!prefix || !isWithinPrefix(target, prefix)) {
            continue
        }
        if (!best || prefix.length > best.prefix.length) {
            best = { prefix, token }
        }
    }
    return best?.token
}

/**
 * Spawn-time lookup: reads the runner-local settings file and resolves the
 * first of `directories` that matches a profile. Callers pass the most
 * specific path first (the resolved spawn cwd) followed by the requested
 * workspace directory, so a worktree materialized outside the configured
 * prefix still inherits its base repository's profile.
 *
 * Returns `undefined` — leaving the spawn environment byte-for-byte as it was
 * before this feature existed — when no profiles are configured, when nothing
 * matches, or when the session is not a Claude session.
 */
export async function resolveDirectoryAuthTokenForSpawn(
    agent: AgentFlavor | undefined,
    directories: Array<string | undefined>
): Promise<string | undefined> {
    if (agent && agent !== 'claude') {
        return undefined
    }
    const { directoryAuthProfiles } = await readSettings()
    if (!Array.isArray(directoryAuthProfiles) || directoryAuthProfiles.length === 0) {
        return undefined
    }
    for (const directory of directories) {
        if (!directory) {
            continue
        }
        const token = resolveDirectoryAuthToken(directory, directoryAuthProfiles)
        if (token) {
            return token
        }
    }
    return undefined
}

export interface SpawnAuthEnvParams {
    agent: AgentFlavor | undefined
    /** Explicit per-spawn token supplied by the hub/mobile app, if any. */
    token: string | undefined
    /** Resolved cwd of the child (the worktree path for worktree sessions). */
    spawnDirectory: string
    /** Workspace directory the session was requested at. */
    directory: string
}

/**
 * Build the credential-carrying environment overrides for a spawned session.
 *
 * Precedence: explicit per-spawn token > directory-scoped profile > nothing
 * (the child inherits the runner's ambient login).
 *
 * With no `directoryAuthProfiles` configured this returns `{}` for every
 * tokenless spawn and the historic single-token env for every tokenful one -
 * i.e. it is a no-op for installs that never opt in.
 */
export async function buildSpawnAuthEnv(params: SpawnAuthEnvParams): Promise<Record<string, string>> {
    const { agent, spawnDirectory, directory } = params
    const token = params.token ?? await resolveDirectoryAuthTokenForSpawn(agent, [spawnDirectory, directory])
    if (!token) {
        return {}
    }

    if (agent === 'codex') {

        // Create a temporary directory for Codex
        const codexHomeDir = await fs.mkdtemp(join(os.tmpdir(), 'hapi-codex-'))

        // Write the token to the temporary directory
        await fs.writeFile(join(codexHomeDir, 'auth.json'), token)

        // Set the environment variable for Codex
        return {
            CODEX_HOME: codexHomeDir
        }
    }

    if (agent === 'claude' || !agent) {
        return {
            CLAUDE_CODE_OAUTH_TOKEN: token
        }
    }

    return {}
}
