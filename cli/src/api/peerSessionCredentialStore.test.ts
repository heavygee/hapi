import { afterEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const { home } = vi.hoisted(() => {
    const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join: pathJoin } = require('node:path') as typeof import('node:path')
    return {
        home: mkdtempSync(pathJoin(tmpdir(), 'hapi-peer-cap-')),
    }
})

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: home,
    },
}))

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}))

import { loadPeerSessionCredentials, savePeerSessionCredentials } from './peerSessionCredentialStore'

describe('peerSessionCredentialStore', () => {
    afterEach(() => {
        rmSync(join(home, 'peer-session-credentials'), { recursive: true, force: true })
    })

    it('round-trips credentials for a session id and isolates siblings', () => {
        const sessionId = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        savePeerSessionCredentials({
            sessionId,
            sessionTag: 'tag-aaaa',
            sessionCapability: 'cap-bbbb',
        })
        expect(loadPeerSessionCredentials(sessionId)).toEqual({
            sessionId,
            sessionTag: 'tag-aaaa',
            sessionCapability: 'cap-bbbb',
        })
        expect(loadPeerSessionCredentials('05d9f0f2-9273-4137-933c-07459a1146a2')).toBeNull()
    })
})
