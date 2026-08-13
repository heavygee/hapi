import { describe, expect, it } from 'bun:test'
import { Store } from './index'

const SOURCE_ID = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'

function makeStore(): Store {
    return new Store(':memory:')
}

describe('scanUnverifiedPeerMessages', () => {
    it('returns unverified peer rows and skips attributed peer / webapp', () => {
        const store = makeStore()
        const session = store.sessions.getOrCreateSession(
            'scan-peer',
            { path: '/tmp/scan-peer', name: 'Target session' },
            null,
            'default'
        )
        const now = Date.now()

        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'unverified ping' },
            meta: { sentFrom: 'peer' },
        })
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'attributed ping' },
            meta: {
                sentFrom: 'peer',
                peer: { sourceSessionId: SOURCE_ID, sourceName: 'Orchestrator' },
            },
        })
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'webapp' },
            meta: { sentFrom: 'webapp' },
        })

        const result = store.scanUnverifiedPeerMessages('default', {
            sinceMs: now - 60_000,
            limit: 10,
            maxScan: 100,
        })

        expect(result.meta.unverifiedTotal).toBe(1)
        expect(result.rows).toHaveLength(1)
        expect(result.rows[0]).toMatchObject({
            sessionId: session.id,
            sessionName: 'Target session',
            textPreview: 'unverified ping',
            claimedPeerHeaderInText: false,
        })
        store.close()
    })

    it('respects limit while counting full unverified total', () => {
        const store = makeStore()
        const session = store.sessions.getOrCreateSession('scan-limit', { path: '/tmp/limit' }, null, 'default')
        const now = Date.now()

        for (let i = 0; i < 3; i += 1) {
            store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: `ping ${i}` },
                meta: { sentFrom: 'peer' },
            })
        }

        const result = store.scanUnverifiedPeerMessages('default', {
            sinceMs: now - 60_000,
            limit: 2,
            maxScan: 100,
        })

        expect(result.meta.unverifiedTotal).toBe(3)
        expect(result.rows).toHaveLength(2)
        store.close()
    })
})
