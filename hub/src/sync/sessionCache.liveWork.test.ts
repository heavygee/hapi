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

    it('preserves a replacement\'s row-wide tasks across late prior-owner snapshots', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-bg-replace',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'terminal',
                machineId: 'm1',
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            null,
            'default',
        )

        cache.setBackgroundTasks(
            session.id,
            [{ id: 'bg-b', type: 'local_bash', description: 'terminal-task' }],
            { machineId: 'm1', hostPid: 200, processStartMarker: 'worker-B', runnerOwned: false },
        )
        expect(cache.getSession(session.id)?.backgroundTaskCount).toBe(1)

        cache.setBackgroundTasks(
            session.id,
            [],
            { machineId: 'm1', hostPid: 100, processStartMarker: 'worker-A', runnerOwned: true },
        )
        expect(cache.getSession(session.id)?.backgroundTasks?.some((t) => t.id === 'bg-b')).toBe(true)

        // Late nonempty from A must not wipe B.
        cache.setBackgroundTasks(
            session.id,
            [{ id: 'bg-a', type: 'local_bash', description: 'stale-a' }],
            { machineId: 'm1', hostPid: 100, processStartMarker: 'worker-A', runnerOwned: true },
        )
        const tasks = cache.getSession(session.id)?.backgroundTasks ?? []
        expect(tasks.some((t) => t.id === 'bg-b')).toBe(true)
        expect(tasks.some((t) => t.id === 'bg-a')).toBe(true)

        cache.clearTransientBackgroundForOwner(
            session.id,
            liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' }),
        )
        expect(cache.getSession(session.id)?.backgroundTasks?.map((t) => t.id)).toEqual(['bg-b'])
        store.close()
    })

    it('keeps the queued-prompt guard when clearing worker thinking without an idle heartbeat', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-queued-think',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 100,
                hostStartMarker: 'worker-A',
            },
            null,
            'default',
        )
        const keyA = liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' })

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: true,
            machineId: 'm1',
            hostPid: 100,
            processStartMarker: 'worker-A',
        })
        // Prompt accepted while A is thinking — no intervening idle heartbeat.
        cache.markMessageQueued(session.id)
        expect(cache.hasQueuedPromptWork(session.id)).toBe(true)

        cache.clearTransientThinkingForOwner(session.id, keyA)
        expect(cache.getSession(session.id)?.thinking).toBe(true)
        store.close()
    })

    it('bounds transcript work on current-row replacement, not late prior reports', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'live-work-derived-bound',
            {
                path: '/tmp/p',
                host: 'localhost',
                flavor: 'claude',
                startedBy: 'runner',
                startedFromRunner: true,
                machineId: 'm1',
                hostPid: 100,
                hostStartMarker: 'worker-A',
            },
            null,
            'default',
        )

        cache.noteRowGenerationOwner(
            session.id,
            liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' }),
        )
        expect(cache.getTranscriptGenerationBoundaryAt(session.id)).toBeUndefined()

        // Advance row metadata to B (replacement), then note B.
        const before = cache.getSession(session.id)!
        expect(store.sessions.updateSessionMetadata(
            session.id,
            {
                ...before.metadata!,
                hostPid: 200,
                hostStartMarker: 'worker-B',
            },
            before.metadataVersion,
            'default',
        ).result).toBe('success')
        cache.refreshSession(session.id)

        const at = Date.now()
        cache.noteRowGenerationOwner(
            session.id,
            liveWorkOwnerKey({ machineId: 'm1', hostPid: 200, hostStartMarker: 'worker-B' }),
        )
        const boundary = cache.getTranscriptGenerationBoundaryAt(session.id)
        expect(boundary).toBeGreaterThanOrEqual(at)

        // Late A report must not move the cutoff.
        cache.noteRowGenerationOwner(
            session.id,
            liveWorkOwnerKey({ machineId: 'm1', hostPid: 100, hostStartMarker: 'worker-A' }),
        )
        expect(cache.getTranscriptGenerationBoundaryAt(session.id)).toBe(boundary)
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
