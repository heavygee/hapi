import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { dir } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tmpdir } = require('node:os') as typeof import('node:os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join: pathJoin } = require('node:path') as typeof import('node:path')
    return { dir: mkdtempSync(pathJoin(tmpdir(), 'hapi-cli-spawn-auth-')) }
})

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: dir,
        settingsFile: join(dir, 'settings.json'),
        privateKeyFile: join(dir, 'access.key'),
        runnerStateFile: join(dir, 'runner.state.json'),
        runnerLockFile: join(dir, 'runner.state.json.lock'),
        logsDir: join(dir, 'logs'),
    },
}))

import type { DirectoryAuthProfile } from './spawnAuth'
import { buildSpawnAuthEnv, resolveDirectoryAuthToken } from './spawnAuth'

const settingsFile = join(dir, 'settings.json')

function writeProfiles(profiles: unknown): void {
    writeFileSync(settingsFile, JSON.stringify({ machineId: 'm1', directoryAuthProfiles: profiles }))
}

afterEach(() => {
    rmSync(settingsFile, { force: true })
    rmSync(join(dir, 'settings.json.lock'), { force: true })
})

describe('resolveDirectoryAuthToken', () => {
    const profiles: DirectoryAuthProfile[] = [
        { pathPrefix: '/home/op/coding', claudeCodeOAuthToken: 'tree-token' },
        { pathPrefix: '/home/op/coding/sparling', claudeCodeOAuthToken: 'sparling-token' },
    ]

    it('matches the configured directory exactly', () => {
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling', profiles)).toBe('sparling-token')
    })

    it('matches directories nested under the prefix', () => {
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling/api/src', profiles)).toBe('sparling-token')
    })

    it('prefers the longest matching prefix regardless of declaration order', () => {
        const reversed = [...profiles].reverse()
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling/api', reversed)).toBe('sparling-token')
        expect(resolveDirectoryAuthToken('/home/op/coding/other', reversed)).toBe('tree-token')
    })

    it('does not match a sibling directory that shares a name prefix', () => {
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling-old', profiles)).toBe('tree-token')
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling-old/src', profiles)).toBe('tree-token')
    })

    it('returns undefined for a directory outside every profile', () => {
        expect(resolveDirectoryAuthToken('/home/op/elsewhere', profiles)).toBeUndefined()
        expect(resolveDirectoryAuthToken('/home/op/codingzz', profiles)).toBeUndefined()
    })

    it('returns undefined when no profiles are configured', () => {
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling', undefined)).toBeUndefined()
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling', [])).toBeUndefined()
    })

    it('normalizes traversal and trailing separators in both the target and the prefix', () => {
        const trailing: DirectoryAuthProfile[] = [
            { pathPrefix: '/home/op/coding/sparling/', claudeCodeOAuthToken: 'sparling-token' },
        ]
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling/api/..', trailing)).toBe('sparling-token')
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling/../sparling-old', trailing)).toBeUndefined()
    })

    it('expands a leading ~ in the configured prefix', () => {
        const tilde: DirectoryAuthProfile[] = [
            { pathPrefix: '~/coding/sparling', claudeCodeOAuthToken: 'sparling-token' },
        ]
        expect(resolveDirectoryAuthToken(join(homedir(), 'coding', 'sparling', 'api'), tilde)).toBe('sparling-token')
    })

    it('ignores relative prefixes instead of resolving them against the runner cwd', () => {
        const relative = [{ pathPrefix: 'coding/sparling', claudeCodeOAuthToken: 'nope' }] as DirectoryAuthProfile[]
        expect(resolveDirectoryAuthToken(join(process.cwd(), 'coding/sparling'), relative)).toBeUndefined()
    })

    it('skips malformed entries rather than failing the lookup', () => {
        const malformed = [
            null,
            'not-an-object',
            { pathPrefix: '/home/op/coding/sparling' },
            { pathPrefix: '', claudeCodeOAuthToken: 'empty-prefix' },
            { pathPrefix: '/home/op/coding/sparling', claudeCodeOAuthToken: '' },
            { pathPrefix: '/home/op/coding/sparling', claudeCodeOAuthToken: 'good' },
        ] as unknown as DirectoryAuthProfile[]
        expect(resolveDirectoryAuthToken('/home/op/coding/sparling', malformed)).toBe('good')
    })
})

describe('buildSpawnAuthEnv', () => {
    const spawnAt = join(dir, 'workspaces', 'sparling')

    it('is a no-op when settings.json has no directoryAuthProfiles', async () => {
        writeFileSync(settingsFile, JSON.stringify({ machineId: 'm1' }))
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: undefined,
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({})
    })

    it('is a no-op when directoryAuthProfiles is empty', async () => {
        writeProfiles([])
        await expect(buildSpawnAuthEnv({
            agent: undefined,
            token: undefined,
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({})
    })

    it('is a no-op when there is no settings file at all', async () => {
        rmSync(settingsFile, { force: true })
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: undefined,
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({})
    })

    it('still honours an explicit per-spawn token when nothing is configured', async () => {
        writeFileSync(settingsFile, JSON.stringify({ machineId: 'm1' }))
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: 'explicit',
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'explicit' })
    })

    it('applies a matching directory profile to a tokenless Claude spawn', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: undefined,
            spawnDirectory: join(spawnAt, 'api'),
            directory: join(spawnAt, 'api'),
        })).resolves.toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'profile-token' })
    })

    it('treats a missing agent as Claude', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        await expect(buildSpawnAuthEnv({
            agent: undefined,
            token: undefined,
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'profile-token' })
    })

    it('lets an explicit per-spawn token override a matching directory profile', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: 'explicit',
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })).resolves.toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'explicit' })
    })

    it('falls back to the requested workspace directory when the spawn cwd is a worktree elsewhere', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: undefined,
            spawnDirectory: join(dir, 'worktrees', 'sparling-feature'),
            directory: spawnAt,
        })).resolves.toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'profile-token' })
    })

    it('leaves non-Claude agents on the ambient login', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        for (const agent of ['codex', 'cursor', 'gemini'] as const) {
            await expect(buildSpawnAuthEnv({
                agent,
                token: undefined,
                spawnDirectory: spawnAt,
                directory: spawnAt,
            })).resolves.toEqual({})
        }
    })

    it('keeps the Codex temp-CODEX_HOME behaviour for explicit tokens', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        const env = await buildSpawnAuthEnv({
            agent: 'codex',
            token: 'codex-auth-json',
            spawnDirectory: spawnAt,
            directory: spawnAt,
        })
        expect(Object.keys(env)).toEqual(['CODEX_HOME'])
        expect(readFileSync(join(env.CODEX_HOME!, 'auth.json'), 'utf8')).toBe('codex-auth-json')
        rmSync(env.CODEX_HOME!, { recursive: true, force: true })
    })

    it('does not match a sibling of the configured directory', async () => {
        writeProfiles([{ pathPrefix: spawnAt, claudeCodeOAuthToken: 'profile-token' }])
        await expect(buildSpawnAuthEnv({
            agent: 'claude',
            token: undefined,
            spawnDirectory: `${spawnAt}-old`,
            directory: `${spawnAt}-old`,
        })).resolves.toEqual({})
    })
})
