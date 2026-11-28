import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { liveWorkOwnerKey } from './liveWorkByGeneration'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        },
    } as unknown as EventPublisher
}

describe('SessionCache liveWorkByGeneration attribution (#2658)', () => {
    it('binds a late prior-worker heartbeat to that owner, not the current row', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-attr',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            null,
            'default',
        )

        // Late report from replaced worker A after B registered.
        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: true,
            machineId: 'm1',
            hostPid: 100,
            processStartMarker: 'worker-A',
        })
        const keyA = liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' })
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[keyA]?.unresolvedTurn).toBe(true)

        // B goes idle — must not erase A's latch.
        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            machineId: 'm1',
            hostPid: 200,
            processStartMarker: 'worker-B',
        })
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[keyA]?.unresolvedTurn).toBe(true)
        store.close()
    })

    it('attributes a cross-machine late report to the reporting machine, not the current row', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-cross-machine',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'machine-B',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            null,
            'default',
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: true,
            machineId: 'machine-A',
            hostPid: 100,
            processStartMarker: 'worker-A',
        })
        const keyA = liveWorkOwnerKey({ machineId: 'machine-A', hostPid: 100, hostStartMarker: 'worker-A' })
        const entry = cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[keyA]
        expect(entry?.unresolvedTurn).toBe(true)
        expect(entry?.machineId).toBe('machine-A')
        store.close()
    })

    it('does not durable-latch terminal sessions (transient thinking only)', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-terminal',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'terminal',
                machineId: 'm1',
                hostPid: 50,
            },
            null,
            'default',
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: true,
            hostPid: 50,
            processStartMarker: 'term-marker',
        })
        expect(cache.getSession(session.id)?.thinking).toBe(true)
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration).toBeUndefined()
        store.close()
    })

    it('durable-latches attributed background snapshots under the reporting owner', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-bg',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            null,
            'default',
        )

        cache.setBackgroundTasks(
            session.id,
            [{ id: 'bg-1', type: 'local_bash', description: 'sleep' }],
            { machineId: 'm1', hostPid: 100, processStartMarker: 'worker-A' },
        )
        const keyA = liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' })
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[keyA]?.backgroundTasks).toHaveLength(1)

        // Empty snapshot from B must not erase A's durable bg latch.
        cache.setBackgroundTasks(
            session.id,
            [],
            { machineId: 'm1', hostPid: 200, processStartMarker: 'worker-B' },
        )
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[keyA]?.backgroundTasks).toHaveLength(1)
        store.close()
    })

    it('skips durable write/clear when the heartbeat omits owner identity', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-unmarked',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            null,
            'default',
        )
        const priorKey = liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' })
        const before = cache.getSession(session.id)!
        expect(store.sessions.updateSessionMetadata(
            session.id,
            {
                ...before.metadata!,
                liveWorkByGeneration: {
                    [priorKey]: {
                        machineId: 'm1',
                        hostPid: 100,
                        hostStartMarker: 'worker-A',
                        since: Date.now() - 1000,
                        unresolvedTurn: true,
                    },
                },
            },
            before.metadataVersion,
            'default',
        ).result).toBe('success')
        cache.refreshSession(session.id)

        // Unmarked idle heartbeat must not clear A's entry or invent a B latch.
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })
        expect(cache.getSession(session.id)?.metadata?.liveWorkByGeneration?.[priorKey]?.unresolvedTurn).toBe(true)
        store.close()
    })

    it('clears only permission requests for the verified full owner identity', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-requests',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            {
                requests: {
                    a: {
                        tool: 'Bash',
                        arguments: {},
                        machineId: 'm1',
                        hostPid: 100,
                        hostStartMarker: 'worker-A',
                    },
                    b: {
                        tool: 'Edit',
                        arguments: {},
                        machineId: 'm1',
                        hostPid: 200,
                        hostStartMarker: 'worker-B',
                    },
                    // Same marker as A but different PID — must not clear with A.
                    collide: {
                        tool: 'Read',
                        arguments: {},
                        machineId: 'm1',
                        hostPid: 999,
                        hostStartMarker: 'worker-A',
                    },
                    unmarked: { tool: 'Read', arguments: {} },
                },
            },
            'default',
        )

        cache.clearPendingAgentRequestsForOwner(session.id, {
            machineId: 'm1',
            hostPid: 100,
            hostStartMarker: 'worker-A',
        })
        const afterA = cache.getSession(session.id)?.agentState?.requests
        expect(afterA?.a).toBeUndefined()
        expect(afterA?.b).toBeDefined()
        expect(afterA?.collide).toBeDefined()
        expect(afterA?.unmarked).toBeDefined()
        store.close()
    })
})
