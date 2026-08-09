import { afterEach, describe, expect, it } from 'vitest'
import { openSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    HAPI_PEER_SESSION_TAG_FD_ENV,
    consumePeerSessionTagFromFd,
} from './peerSessionTagFd'

describe('consumePeerSessionTagFromFd', () => {
    const paths: string[] = []

    afterEach(() => {
        delete process.env[HAPI_PEER_SESSION_TAG_FD_ENV]
        for (const path of paths.splice(0)) {
            try {
                unlinkSync(path)
            } catch {
                // ignore
            }
        }
    })

    it('reads a one-line tag from the fd named by env and closes it', () => {
        const path = join(tmpdir(), `hapi-peer-tag-${process.pid}-${Date.now()}`)
        paths.push(path)
        writeFileSync(path, 'tag-from-runner\n', { mode: 0o600 })
        const fd = openSync(path, 'r')
        process.env[HAPI_PEER_SESSION_TAG_FD_ENV] = String(fd)

        const tag = consumePeerSessionTagFromFd()
        expect(tag).toBe('tag-from-runner')
        expect(process.env[HAPI_PEER_SESSION_TAG_FD_ENV]).toBeUndefined()

        // Second read: env gone → no blocking read of a random fd.
        expect(consumePeerSessionTagFromFd()).toBeUndefined()
    })

    it('returns undefined when the fd env is unset (does not touch fd 3)', () => {
        expect(consumePeerSessionTagFromFd()).toBeUndefined()
    })
})
