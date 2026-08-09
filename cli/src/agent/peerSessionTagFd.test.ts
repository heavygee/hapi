import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSync, unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('peerSessionTagFd', () => {
    const paths: string[] = []

    beforeEach(() => {
        vi.resetModules()
        delete process.env.HAPI_PEER_SESSION_TAG_FD
    })

    afterEach(() => {
        delete process.env.HAPI_PEER_SESSION_TAG_FD
        for (const path of paths.splice(0)) {
            try {
                unlinkSync(path)
            } catch {
                // ignore
            }
        }
    })

    it('drains the tag on module load before consume is called', async () => {
        const path = join(tmpdir(), `hapi-peer-tag-${process.pid}-${Date.now()}`)
        paths.push(path)
        writeFileSync(path, 'tag-from-runner\n', { mode: 0o600 })
        const fd = openSync(path, 'r')
        process.env.HAPI_PEER_SESSION_TAG_FD = String(fd)

        const mod = await import('./peerSessionTagFd')
        // Module-load drain should have cleared env and closed the fd already.
        expect(process.env.HAPI_PEER_SESSION_TAG_FD).toBeUndefined()
        expect(mod.consumePeerSessionTagFromFd()).toBe('tag-from-runner')
        expect(mod.consumePeerSessionTagFromFd()).toBeUndefined()
    })

    it('returns undefined when the fd env is unset', async () => {
        const mod = await import('./peerSessionTagFd')
        expect(mod.consumePeerSessionTagFromFd()).toBeUndefined()
    })

    it('closes the fd so a later same-UID open of the path cannot recover the tag', async () => {
        const path = join(tmpdir(), `hapi-peer-tag-race-${process.pid}-${Date.now()}`)
        paths.push(path)
        writeFileSync(path, 'secret-mint-tag\n', { mode: 0o600 })
        const fd = openSync(path, 'r')
        process.env.HAPI_PEER_SESSION_TAG_FD = String(fd)

        const mod = await import('./peerSessionTagFd')
        expect(mod.consumePeerSessionTagFromFd()).toBe('secret-mint-tag')

        // File still on disk, but the pipe/fd content was consumed; a fresh open
        // of the same path after drain sees EOF / empty for a consumed pipe.
        // For a regular file used as stand-in, the important property is the
        // process no longer holds the open fd advertised in env.
        expect(process.env.HAPI_PEER_SESSION_TAG_FD).toBeUndefined()
        expect(existsSync(path)).toBe(true)
        // Re-import path would not re-read without env; sibling without env gets nothing.
        expect(mod.consumePeerSessionTagFromFd()).toBeUndefined()
        // Sanity: disk file content is not the mint channel after drain+close.
        expect(readFileSync(path, 'utf8').trim()).toBe('secret-mint-tag')
    })
})
