import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_START_TIMEOUT_MS_MAX } from '@hapi/protocol'
import { readSessionStartTimeoutMs } from './sessionStartTimeout'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function settingsFileWith(contents: string | null): Promise<string> {
    const dataDir = await mkdtemp(join(tmpdir(), 'hapi-session-start-timeout-'))
    directories.push(dataDir)
    const settingsFile = join(dataDir, 'settings.json')
    if (contents !== null) {
        await writeFile(settingsFile, contents)
    }
    return settingsFile
}

describe('readSessionStartTimeoutMs', () => {
    it('returns null when the file does not exist', async () => {
        expect(await readSessionStartTimeoutMs(await settingsFileWith(null))).toBeNull()
    })

    it('returns null when the setting is unset', async () => {
        expect(await readSessionStartTimeoutMs(await settingsFileWith('{"listenPort":3006}'))).toBeNull()
    })

    it('returns the configured value', async () => {
        expect(await readSessionStartTimeoutMs(await settingsFileWith('{"sessionStartTimeoutMs":60000}'))).toBe(60_000)
    })

    it('clamps a value that is out of range on disk', async () => {
        expect(await readSessionStartTimeoutMs(await settingsFileWith('{"sessionStartTimeoutMs":86400000}')))
            .toBe(SESSION_START_TIMEOUT_MS_MAX)
    })

    it('falls back to null rather than throwing on a corrupt settings file', async () => {
        expect(await readSessionStartTimeoutMs(await settingsFileWith('{not json'))).toBeNull()
    })
})
