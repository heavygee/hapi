import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

/**
 * Regression tests for hapi#238 (Codex review): `mergeSessionMetadata`
 * carried over name/summary/worktree/path/host but never externalRefs, so
 * `mergeSessions` (old session deleted after merge) silently dropped any
 * issue/PR links the old session had — Boards would offer another spawn,
 * and the fork's own PR tooling (which discovers sessions from `github_pr`
 * chips, not titles) would lose track of the session entirely.
 */

function createCapturingPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

function setup() {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const cache = new SessionCache(store, createCapturingPublisher(events))
    return { store, events, cache }
}

function makeSessions(cache: SessionCache, ns: string = 'default') {
    const oldSession = cache.getOrCreateSession(
        'agent-merge-old-' + Math.random().toString(36).slice(2, 8),
        { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
        null,
        ns
    )
    const newSession = cache.getOrCreateSession(
        'agent-merge-new-' + Math.random().toString(36).slice(2, 8),
        { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
        null,
        ns
    )
    return { oldSession, newSession }
}

describe('mergeSessions - externalRefs preservation', () => {
    it('carries an old-session-only issue link onto the surviving session', async () => {
        const { cache } = setup()
        const { oldSession, newSession } = makeSessions(cache)

        await cache.linkIssue(oldSession.id, {
            kind: 'github_issue',
            url: 'https://github.com/heavygee/hapi/issues/235',
            repo: 'heavygee/hapi',
            number: 235,
            linkedAt: 1
        })

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.metadata?.externalRefs).toEqual([
            { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        ])
    })

    it('keeps the new session own ref on a collision instead of letting the old one clobber it', async () => {
        const { cache } = setup()
        const { oldSession, newSession } = makeSessions(cache)

        await cache.linkIssue(oldSession.id, {
            kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1
        })
        await cache.linkIssue(newSession.id, {
            kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 99
        })

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.metadata?.externalRefs).toHaveLength(1)
        expect(merged?.metadata?.externalRefs?.[0]?.linkedAt).toBe(99)
    })

    it('unions refs from both sessions when they link different issues', async () => {
        const { cache } = setup()
        const { oldSession, newSession } = makeSessions(cache)

        await cache.linkIssue(oldSession.id, {
            kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/1', repo: 'heavygee/hapi', number: 1, linkedAt: 1
        })
        await cache.linkIssue(newSession.id, {
            kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/2', repo: 'heavygee/hapi', number: 2, linkedAt: 2
        })

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.metadata?.externalRefs?.map(r => r.number).sort()).toEqual([1, 2])
    })

    it('is a no-op when neither session has externalRefs', async () => {
        const { cache } = setup()
        const { oldSession, newSession } = makeSessions(cache)

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.metadata?.externalRefs ?? []).toEqual([])
    })
})
