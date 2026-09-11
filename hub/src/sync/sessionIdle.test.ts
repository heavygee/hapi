import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'
import {
    DEFAULT_SESSION_IDLE_TIMEOUT_MS,
    resolveSessionIdleTimeoutMs,
    shouldClearKeepaliveIdle,
    shouldMarkKeepaliveIdle,
} from './sessionIdle'

const HOUR = 60 * 60 * 1000
const NOW = 1_800_000_000_000

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

function session(overrides: Partial<Session> = {}): Session {
    return {
        id: 'sid',
        namespace: 'default',
        seq: 0,
        createdAt: NOW - 100 * HOUR,
        updatedAt: NOW - 100 * HOUR,
        active: true,
        activeAt: NOW,
        metadata: { path: '/tmp/p', host: 'h', lifecycleState: 'running' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: NOW,
        ...overrides
    } as Session
}

describe('resolveSessionIdleTimeoutMs', () => {
    it('defaults when unset or unparseable', () => {
        expect(resolveSessionIdleTimeoutMs({})).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
        expect(resolveSessionIdleTimeoutMs({ HAPI_SESSION_IDLE_TIMEOUT_MS: '  ' })).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
        expect(resolveSessionIdleTimeoutMs({ HAPI_SESSION_IDLE_TIMEOUT_MS: 'soon' })).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
        expect(resolveSessionIdleTimeoutMs({ HAPI_SESSION_IDLE_TIMEOUT_MS: '-1' })).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
    })

    it('honours an explicit window, and 0 disables', () => {
        expect(resolveSessionIdleTimeoutMs({ HAPI_SESSION_IDLE_TIMEOUT_MS: '3600000' })).toBe(3_600_000)
        expect(resolveSessionIdleTimeoutMs({ HAPI_SESSION_IDLE_TIMEOUT_MS: '0' })).toBe(0)
    })
})

describe('shouldMarkKeepaliveIdle', () => {
    const window = 12 * HOUR

    it('marks a session whose only sign of life is the keepalive', () => {
        expect(shouldMarkKeepaliveIdle(session(), NOW - 87 * HOUR, NOW, window)).toBe(true)
    })

    it('leaves a session inside the window alone', () => {
        expect(shouldMarkKeepaliveIdle(session(), NOW - 2 * HOUR, NOW, window)).toBe(false)
    })

    it('is disabled by a zero window', () => {
        expect(shouldMarkKeepaliveIdle(session(), NOW - 87 * HOUR, NOW, 0)).toBe(false)
    })

    it('never marks work the hub can see', () => {
        const stale = NOW - 87 * HOUR
        expect(shouldMarkKeepaliveIdle(session({ thinking: true }), stale, NOW, window)).toBe(false)
        expect(shouldMarkKeepaliveIdle(session({ backgroundTaskCount: 1 }), stale, NOW, window)).toBe(false)
        expect(shouldMarkKeepaliveIdle(
            session({ agentState: { requests: { 'req-1': { tool: 'Bash', arguments: {} } } } as Session['agentState'] }),
            stale, NOW, window
        )).toBe(false)
    })

    it('honours the explicit escape hatch', () => {
        const exempt = session({ metadata: { path: '/tmp/p', host: 'h', lifecycleState: 'running', idleReconcileExempt: true } })
        expect(shouldMarkKeepaliveIdle(exempt, NOW - 87 * HOUR, NOW, window)).toBe(false)
    })

    it('only touches live running rows', () => {
        const stale = NOW - 87 * HOUR
        expect(shouldMarkKeepaliveIdle(session({ active: false }), stale, NOW, window)).toBe(false)
        expect(shouldMarkKeepaliveIdle(
            session({ metadata: { path: '/tmp/p', host: 'h', lifecycleState: 'archived' } }),
            stale, NOW, window
        )).toBe(false)
        expect(shouldMarkKeepaliveIdle(
            session({ metadata: { path: '/tmp/p', host: 'h' } }),
            stale, NOW, window
        )).toBe(false)
    })
})

describe('shouldClearKeepaliveIdle', () => {
    const window = 12 * HOUR
    const idle = (overrides: Partial<Session> = {}) => session({
        metadata: { path: '/tmp/p', host: 'h', lifecycleState: 'idle' },
        ...overrides
    })

    it('wakes on fresh progress', () => {
        expect(shouldClearKeepaliveIdle(idle(), NOW - 1 * HOUR, NOW, window)).toBe(true)
    })

    it('does not wake on ambient thinking churn (tiann/hapi#1553) — that would flap every tick', () => {
        expect(shouldClearKeepaliveIdle(idle({ thinking: true }), NOW - 87 * HOUR, NOW, window)).toBe(false)
    })

    it('wakes when the escape hatch is set after the fact', () => {
        const exempt = session({ metadata: { path: '/tmp/p', host: 'h', lifecycleState: 'idle', idleReconcileExempt: true } })
        expect(shouldClearKeepaliveIdle(exempt, NOW - 87 * HOUR, NOW, window)).toBe(true)
    })

    it('stays idle while nothing has happened', () => {
        expect(shouldClearKeepaliveIdle(idle(), NOW - 87 * HOUR, NOW, window)).toBe(false)
    })

    it('ignores sessions that are not idle', () => {
        expect(shouldClearKeepaliveIdle(session(), NOW - 1 * HOUR, NOW, window)).toBe(false)
    })
})

describe('SessionCache.reconcileKeepaliveIdle', () => {
    const window = 12 * HOUR

    function setup() {
        const events: SyncEvent[] = []
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher(events))
        const created = cache.getOrCreateSession(
            'tag-1',
            { path: '/tmp/project', host: 'localhost', flavor: 'cursor', lifecycleState: 'running' },
            null,
            'default'
        )
        // The row is stamped "now"; walk the clock forward instead of
        // rewriting persisted timestamps, so `updatedAt` stays honest across
        // the refreshSession that a lifecycle write performs.
        return { store, cache, events, sessionId: created.id, later: Date.now() + 87 * HOUR }
    }

    it('reconciles a keepalive-only session to idle without touching active', () => {
        const { cache, sessionId, later } = setup()

        // 87h of keepalives, nothing else — exactly the #1820 sample.
        cache.handleSessionAlive({ sid: sessionId, time: Date.now() })
        expect(cache.getSession(sessionId)!.active).toBe(true)

        expect(cache.reconcileKeepaliveIdle(later, window)).toEqual([sessionId])

        const marked = cache.getSession(sessionId)!
        expect(marked.metadata?.lifecycleState).toBe('idle')
        // The CLI socket really is up; flipping `active` would arm the
        // resume-respawn / dedup / delete paths against a live process.
        expect(marked.active).toBe(true)
    })

    it('keepalives alone never wake it back up, but agent progress does', () => {
        const { cache, sessionId, later } = setup()
        cache.handleSessionAlive({ sid: sessionId, time: Date.now() })
        cache.reconcileKeepaliveIdle(later, window)
        expect(cache.getSession(sessionId)!.metadata?.lifecycleState).toBe('idle')

        cache.handleSessionAlive({ sid: sessionId, time: Date.now() })
        cache.reconcileKeepaliveIdle(later, window)
        expect(cache.getSession(sessionId)!.metadata?.lifecycleState).toBe('idle')

        cache.recordAgentProgress(sessionId, later)
        cache.reconcileKeepaliveIdle(later, window)
        expect(cache.getSession(sessionId)!.metadata?.lifecycleState).toBe('running')
    })

    it('does nothing when the window is disabled', () => {
        const { cache, sessionId, later } = setup()
        cache.handleSessionAlive({ sid: sessionId, time: Date.now() })

        expect(cache.reconcileKeepaliveIdle(later, 0)).toEqual([])
        expect(cache.getSession(sessionId)!.metadata?.lifecycleState).toBe('running')
    })
})
