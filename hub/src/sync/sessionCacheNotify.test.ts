import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function makeCache(): { cache: SessionCache; store: Store } {
    const store = new Store(':memory:')
    const cache = new SessionCache(store, { emit: (_event: SyncEvent) => {} } as EventPublisher)
    return { cache, store }
}

function seedBlocked(cache: SessionCache, tag: string): string {
    const session = cache.getOrCreateSession(
        tag,
        { path: '/tmp/project', host: 'localhost' },
        null,
        'default'
    )
    cache.markSessionActive(session.id)
    cache.setSessionLastNotify(session.id, { status: 'blocked', at: Date.now(), note: 'needs creds' })
    expect(cache.getSession(session.id)?.lastNotify?.status).toBe('blocked')
    return session.id
}

describe('turn abandonment on keep-alive expiry (#1717)', () => {
    it('stamps a blocker when a session expires mid-turn', () => {
        // The wedge case: agent claimed to be working, then its process stopped
        // heartbeating. No footer will ever arrive, so the hub speaks for it.
        const { cache } = makeCache()
        const session = cache.getOrCreateSession(
            'expire-thinking',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: true })

        cache.expireInactive(Date.now() + 60_000)

        const after = cache.getSession(session.id)
        expect(after?.active).toBe(false)
        expect(after?.thinking).toBe(false)
        expect(after?.lastNotify?.status).toBe('hub_turn_abandoned')
    })

    it('does not stamp a session that expired while idle', () => {
        // Finished cleanly then disconnected — that is not a blocker.
        const { cache } = makeCache()
        const session = cache.getOrCreateSession(
            'expire-idle',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        cache.expireInactive(Date.now() + 60_000)

        expect(cache.getSession(session.id)?.lastNotify).toBeNull()
    })

    it('clears thinking in the emitted patch, not just in memory', () => {
        // The web applies `thinking: patch.thinking ?? current.thinking`, so
        // omitting it left expired sessions displaying "thinking" forever —
        // which also suppressed their blocked chrome.
        const patches: unknown[] = []
        const store = new Store(':memory:')
        const cache = new SessionCache(store, {
            emit: (event: SyncEvent) => {
                if (event.type === 'session-updated') patches.push(event.data)
            }
        } as EventPublisher)
        const session = cache.getOrCreateSession(
            'expire-patch',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: true })
        patches.length = 0

        cache.expireInactive(Date.now() + 60_000)

        const expiryPatch = patches.find((p) => {
            const record = p as Record<string, unknown>
            return record?.active === false
        }) as Record<string, unknown> | undefined
        expect(expiryPatch?.thinking).toBe(false)
        expect(expiryPatch?.activeTurnStartedAt).toBeNull()
    })
})

describe('lastNotify clearing on turn start (#1717)', () => {
    it('clears when the operator sends a message', () => {
        // markMessageQueued sets thinking=true itself, before any CLI
        // keep-alive lands — so a rising-edge check in handleSessionAlive
        // alone would never fire for the reply path and the stale "Blocked"
        // chrome would survive the operator answering.
        const { cache } = makeCache()
        const id = seedBlocked(cache, 'notify-clear-queued')

        cache.markMessageQueued(id)

        expect(cache.getSession(id)?.lastNotify).toBeNull()
    })

    it('clears when the CLI reports the agent started thinking', () => {
        const { cache } = makeCache()
        const id = seedBlocked(cache, 'notify-clear-alive')

        cache.handleSessionAlive({ sid: id, time: Date.now(), thinking: true })

        expect(cache.getSession(id)?.lastNotify).toBeNull()
    })

    it('keeps the footer while the session stays idle', () => {
        const { cache } = makeCache()
        const id = seedBlocked(cache, 'notify-keep-idle')

        cache.handleSessionAlive({ sid: id, time: Date.now(), thinking: false })

        expect(cache.getSession(id)?.lastNotify?.status).toBe('blocked')
    })

    it('does not re-clear on every keep-alive of an already-thinking session', () => {
        const { cache } = makeCache()
        const id = seedBlocked(cache, 'notify-keep-thinking')
        cache.handleSessionAlive({ sid: id, time: Date.now(), thinking: true })

        // A footer arriving mid-turn must survive later keep-alives that carry
        // no rising edge, or a blocked report would be erased the moment the
        // next keep-alive tick lands.
        cache.setSessionLastNotify(id, { status: 'blocked', at: Date.now(), note: 'still stuck' })
        cache.handleSessionAlive({ sid: id, time: Date.now(), thinking: true })

        expect(cache.getSession(id)?.lastNotify?.status).toBe('blocked')
    })
})
