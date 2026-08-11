import { describe, expect, it, mock } from 'bun:test'
import type { NotifySummary } from '@hapi/protocol/messages'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
import type { OverseerLlmFallbackClient } from './overseerLlmFallback'
import { OverseerEventRecorder, toSessionSnapshot } from './overseerEventRecorder'

function makeSession(id: string, flavor: string, overrides?: Partial<Session>): Session {
    return {
        id,
        namespace: 'default',
        seq: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: { flavor, path: '/tmp', host: 'local' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        ...overrides
    }
}

function agentText(message: string) {
    return {
        role: 'agent',
        content: { type: 'codex', data: { type: 'message', message } }
    }
}

describe('OverseerEventRecorder LLM fallback', () => {
    it('uses hub-llm-fallback provenance and keeps attn=0 when LLM succeeds', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async (plainText: string): Promise<NotifySummary | null> => {
            expect(plainText).toContain('Refactored the parser')
            expect(plainText).toContain('More detail here.')
            return {
                version: 1,
                status: 'blocked',
                action: 'Unblock CI',
                summary: 'LLM distilled summary of the whole turn',
            }
        })
        const llmFallback: OverseerLlmFallbackClient = { synthesizeNotifySummary: synthesize }
        const recorder = new OverseerEventRecorder(store.events, store.inbox, { llmFallback })
        const session = store.sessions.getOrCreateSession('llm1', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-llm',
            agentText('Refactored the parser and added tests.\n\nMore detail here.'),
            Date.now()
        )

        expect(synthesize).toHaveBeenCalledTimes(1)
        expect(event).not.toBeNull()
        expect(event?.summary).toBe('LLM distilled summary of the whole turn')
        expect(event?.eventType).toBe('blocked')
        expect(event?.attentionCandidate).toBe(0)
        expect(event?.operatorActionRequired).toBe(0)
        expect(event?.provenance).toContain('hub-llm-fallback')
        expect(store.inbox.count()).toBe(0)

        const payload = JSON.parse(event!.payloadJson!) as {
            synthesized?: boolean
            synthesis?: string
            notify_summary?: NotifySummary
        }
        expect(payload.synthesized).toBe(true)
        expect(payload.synthesis).toBe('llm-fallback')
        expect(payload.notify_summary?.summary).toBe('LLM distilled summary of the whole turn')
    })

    it('records nothing when LLM returns null (no heuristic)', async () => {
        const store = new Store(':memory:')
        const llmFallback: OverseerLlmFallbackClient = {
            synthesizeNotifySummary: mock(async () => null),
        }
        const recorder = new OverseerEventRecorder(store.events, store.inbox, { llmFallback })
        const session = store.sessions.getOrCreateSession('llm2', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-llm-fail',
            agentText('First line wins.\nSecond line.'),
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
    })

    it('does not call LLM when a real AGENT_NOTIFY_SUMMARY is present', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async () => ({ status: 'done', summary: 'should not run' }))
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const session = store.sessions.getOrCreateSession('llm3', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-real',
            agentText('All done.\nAGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review PR","summary":"Shipped"}'),
            Date.now()
        )

        expect(synthesize).toHaveBeenCalledTimes(0)
        expect(event?.provenance).toBe('AGENT_NOTIFY_SUMMARY')
    })

    it('records nothing when LLM client is not configured', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('llm4', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-off',
            agentText('No synth path.'),
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
    })

    it('records nothing when LLM throws (no heuristic)', async () => {
        const store = new Store(':memory:')
        const llmFallback: OverseerLlmFallbackClient = {
            synthesizeNotifySummary: mock(async () => {
                throw new Error('network down')
            }),
        }
        const recorder = new OverseerEventRecorder(store.events, store.inbox, { llmFallback })
        const session = store.sessions.getOrCreateSession('llm5', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-throw',
            agentText('Should stay quiet.'),
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
    })

    it('maps stalled LLM status to progress so Session Log All still shows it', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => ({
                    status: 'stalled',
                    summary: 'Agent went quiet mid-turn',
                })),
            },
        })
        const session = store.sessions.getOrCreateSession('llm-stale', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-stalled',
            agentText('Still working on the rebase.'),
            Date.now()
        )

        expect(event?.eventType).toBe('progress')
        expect(event?.attentionCandidate).toBe(0)
        const payload = JSON.parse(event!.payloadJson!) as { notify_summary?: NotifySummary }
        expect(payload.notify_summary?.status).toBe('stalled')
    })

    it('flushes deferred LLM fallback when thinking clears', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async () => ({ status: 'done', summary: 'End of turn' }))
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const live = store.sessions.getOrCreateSession('llm-think', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(live.id, 'cursor'), live.tag)

        expect(await recorder.onAgentMessage(snapshot, 'msg-mid', agentText('Partial flush.'), Date.now(), { thinking: true })).toBeNull()
        expect(synthesize).toHaveBeenCalledTimes(0)

        const flushed = await recorder.flushPendingLlmFallback(snapshot)
        expect(synthesize).toHaveBeenCalledTimes(1)
        expect(flushed?.summary).toBe('End of turn')
        expect(store.events.count()).toBe(1)
    })

    it('flushes pending fallback from onSessionUpdated when thinking is false', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async () => ({ status: 'blocked', summary: 'Need a decision' }))
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const live = makeSession('sess-alive', 'cursor', { thinking: true })
        const stored = store.sessions.getOrCreateSession('llm-alive', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        await recorder.onAgentMessage(snapshot, 'msg-pending', agentText('No notify yet.'), Date.now(), { thinking: true })
        expect(store.events.count()).toBe(0)

        live.thinking = false
        await recorder.onSessionUpdated(live, stored.tag)

        expect(synthesize).toHaveBeenCalledTimes(1)
        expect(store.events.list({ eventType: 'blocked' })).toHaveLength(1)
    })

    it('does not insert session-end completed_fallback after a successful LLM flush', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => ({
                    status: 'done',
                    summary: 'LLM caught the last turn',
                })),
            },
        })
        const live = makeSession('sess-end', 'cursor', { thinking: true })
        const stored = store.sessions.getOrCreateSession('llm-end', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        await recorder.onAgentMessage(snapshot, 'msg-last', agentText('Finishing up.'), Date.now(), { thinking: true })

        const event = await recorder.onSessionEnd(
            live,
            stored.tag,
            Date.now(),
            'completed',
            () => 'Finishing up.'
        )

        expect(event?.provenance).toContain('hub-llm-fallback')
        expect(store.events.count()).toBe(1)
        expect(store.events.list().some((row) => row.provenance?.includes('session-end'))).toBe(false)
    })

    it('serializes LLM fallbacks on one session so earlier turns keep lower ids', async () => {
        const store = new Store(':memory:')
        let releaseFirst: ((value: NotifySummary) => void) | undefined
        const firstGate = new Promise<NotifySummary>((resolve) => {
            releaseFirst = resolve
        })
        let firstStarted!: () => void
        const firstStartedP = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const synthesize = mock(async (plainText: string): Promise<NotifySummary | null> => {
            if (plainText.includes('FIRST')) {
                firstStarted()
                return firstGate
            }
            return { status: 'done', summary: 'second turn' }
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const stored = store.sessions.getOrCreateSession('llm-ord', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)

        const first = recorder.onAgentMessage(snapshot, 'msg-a', agentText('FIRST turn body'), Date.now())
        await firstStartedP
        const second = recorder.onAgentMessage(snapshot, 'msg-b', agentText('SECOND turn body'), Date.now() + 1)
        releaseFirst!({ status: 'done', summary: 'first turn' })
        await Promise.all([first, second])

        const rows = store.events.list().sort((a, b) => a.id - b.id)
        expect(rows.map((row) => row.summary)).toEqual(['first turn', 'second turn'])
    })

    it('accumulates ACP thinking segments before fallback', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async (plainText: string): Promise<NotifySummary | null> => {
            expect(plainText).toContain('First chunk')
            expect(plainText).toContain('Second chunk')
            return { status: 'done', summary: 'both chunks' }
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const stored = store.sessions.getOrCreateSession('llm-acc', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)

        await recorder.onAgentMessage(snapshot, 'msg-1', agentText('First chunk'), Date.now(), { thinking: true })
        await recorder.onAgentMessage(snapshot, 'msg-2', agentText('Second chunk'), Date.now() + 1, { thinking: true })
        const flushed = await recorder.flushPendingLlmFallback(snapshot)

        expect(synthesize).toHaveBeenCalledTimes(1)
        expect(flushed?.summary).toBe('both chunks')
    })

    it('writes completed_fallback when a later missed turn LLM fails', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async (plainText: string): Promise<NotifySummary | null> => {
            if (plainText.includes('first turn')) {
                return { status: 'done', summary: 'caught first' }
            }
            return null
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const live = makeSession('sess-later', 'cursor', { thinking: true })
        const stored = store.sessions.getOrCreateSession('llm-later', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        await recorder.onAgentMessage(snapshot, 'msg-first', agentText('first turn body'), Date.now(), { thinking: true })
        live.thinking = false
        await recorder.onSessionUpdated(live, stored.tag)
        expect(store.events.list({ eventType: 'completed' })).toHaveLength(1)

        await recorder.onAgentMessage(snapshot, 'msg-second', agentText('second turn miss'), Date.now() + 1)
        expect(synthesize).toHaveBeenCalledTimes(2)

        const event = await recorder.onSessionEnd(
            live,
            stored.tag,
            Date.now() + 2,
            'completed',
            () => 'second turn miss'
        )

        expect(event?.provenance).toContain('session-end')
        expect(store.events.list().filter((row) => row.provenance?.includes('session-end'))).toHaveLength(1)
        expect(store.events.list().filter((row) => row.provenance?.includes('hub-llm-fallback'))).toHaveLength(1)
    })

    it('persists scooped links before awaiting LLM', async () => {
        const store = new Store(':memory:')
        let release!: (value: NotifySummary) => void
        const gate = new Promise<NotifySummary>((resolve) => {
            release = resolve
        })
        let started!: () => void
        const startedP = new Promise<void>((resolve) => {
            started = resolve
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => {
                    started()
                    return gate
                }),
            },
        })
        const stored = store.sessions.getOrCreateSession('llm-scoop', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)

        const pending = recorder.onAgentMessage(
            snapshot,
            'msg-url',
            agentText('See https://example.com/docs for details.'),
            Date.now()
        )
        await startedP

        expect(store.events.list({ eventType: 'link_seen' })).toHaveLength(1)
        expect(store.events.list().filter((row) => row.provenance?.includes('hub-llm-fallback'))).toHaveLength(0)

        release({ status: 'done', summary: 'linked turn' })
        await pending
        expect(store.events.list().filter((row) => row.provenance?.includes('hub-llm-fallback'))).toHaveLength(1)
    })

    it('does not append a new turn onto a flush already queued', async () => {
        const store = new Store(':memory:')
        let releaseFirst!: (value: NotifySummary) => void
        const firstGate = new Promise<NotifySummary>((resolve) => {
            releaseFirst = resolve
        })
        let firstStarted!: () => void
        const firstStartedP = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const synthesize = mock(async (plainText: string): Promise<NotifySummary | null> => {
            if (plainText.includes('TURN A')) {
                firstStarted()
                return firstGate
            }
            return { status: 'done', summary: plainText.includes('TURN C') ? 'turn c' : 'turn b' }
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const stored = store.sessions.getOrCreateSession('llm-detach', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)

        const first = recorder.onAgentMessage(snapshot, 'msg-a', agentText('TURN A body'), Date.now())
        await firstStartedP
        await recorder.onAgentMessage(snapshot, 'msg-b', agentText('TURN B body'), Date.now() + 1, { thinking: true })
        const flushedB = recorder.flushPendingLlmFallback(snapshot)
        await recorder.onAgentMessage(snapshot, 'msg-c', agentText('TURN C body'), Date.now() + 2, { thinking: true })

        releaseFirst({ status: 'done', summary: 'turn a' })
        await first
        const eventB = await flushedB
        expect(eventB?.summary).toBe('turn b')

        const eventC = await recorder.flushPendingLlmFallback(snapshot)
        expect(eventC?.summary).toBe('turn c')
    })

    it('queues a later AGENT_NOTIFY_SUMMARY behind an in-flight LLM insert', async () => {
        const store = new Store(':memory:')
        let releaseFirst!: (value: NotifySummary) => void
        const firstGate = new Promise<NotifySummary>((resolve) => {
            releaseFirst = resolve
        })
        let firstStarted!: () => void
        const firstStartedP = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => {
                    firstStarted()
                    return firstGate
                }),
            },
        })
        const stored = store.sessions.getOrCreateSession('llm-notify-ord', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)

        const first = recorder.onAgentMessage(snapshot, 'msg-a', agentText('TURN A body'), Date.now())
        await firstStartedP
        const second = recorder.onAgentMessage(
            snapshot,
            'msg-b',
            agentText('Done.\nAGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review","summary":"real notify"}'),
            Date.now() + 1
        )
        releaseFirst({ status: 'done', summary: 'llm first' })
        await Promise.all([first, second])

        const rows = store.events.list().sort((a, b) => a.id - b.id)
        expect(rows.map((row) => row.summary)).toEqual(['llm first', 'real notify'])
    })

    it('writes completed_fallback after a textless tool turn following LLM success', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => ({
                    status: 'done',
                    summary: 'caught earlier turn',
                })),
            },
        })
        const live = makeSession('sess-tool', 'cursor')
        const stored = store.sessions.getOrCreateSession('llm-tool', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        await recorder.onAgentMessage(snapshot, 'msg-text', agentText('earlier turn body'), Date.now())
        await recorder.onAgentMessage(snapshot, 'msg-tool', {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'tool-call-result', output: { exit_code: 0 } },
            },
        }, Date.now() + 1)

        const event = await recorder.onSessionEnd(
            live,
            stored.tag,
            Date.now() + 2,
            'completed',
            () => 'earlier turn body'
        )
        expect(event?.provenance).toContain('session-end')
    })

    it('does not let an in-flight earlier LLM cover a later tool-only turn', async () => {
        const store = new Store(':memory:')
        let releaseFirst!: (value: NotifySummary) => void
        const firstGate = new Promise<NotifySummary>((resolve) => {
            releaseFirst = resolve
        })
        let firstStarted!: () => void
        const firstStartedP = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => {
                    firstStarted()
                    return firstGate
                }),
            },
        })
        const live = makeSession('sess-inflight', 'cursor')
        const stored = store.sessions.getOrCreateSession('llm-inflight', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        const first = recorder.onAgentMessage(snapshot, 'msg-a', agentText('earlier turn'), Date.now())
        await firstStartedP
        await recorder.onAgentMessage(snapshot, 'msg-tool', {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'tool-call-result', output: { exit_code: 0 } },
            },
        }, Date.now() + 1)
        releaseFirst({ status: 'done', summary: 'caught earlier' })
        await first

        const event = await recorder.onSessionEnd(
            live,
            stored.tag,
            Date.now() + 2,
            'completed',
            () => 'earlier turn'
        )
        expect(event?.provenance).toContain('session-end')
    })

    it('publishes after a successful LLM insert', async () => {
        const store = new Store(':memory:')
        let published = 0
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => ({ status: 'done', summary: 'ok' })),
            },
            onAsyncSystemEvent: () => {
                published += 1
            },
        })
        const stored = store.sessions.getOrCreateSession('llm-pub', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag),
            'msg-pub',
            agentText('Turn body'),
            Date.now()
        )
        expect(published).toBe(1)
    })

    it('forgetSession drops deferred LLM state without flushing', async () => {
        const store = new Store(':memory:')
        const synthesize = mock(async () => ({ status: 'done', summary: 'should not run' }))
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: { synthesizeNotifySummary: synthesize },
        })
        const stored = store.sessions.getOrCreateSession('llm-forget', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(stored.id, 'cursor'), stored.tag)
        await recorder.onAgentMessage(snapshot, 'msg-p', agentText('pending'), Date.now(), { thinking: true })
        recorder.forgetSession(stored.id)
        expect(await recorder.flushPendingLlmFallback(snapshot)).toBeNull()
        expect(synthesize).toHaveBeenCalledTimes(0)
    })

    it('queues permission requests behind an in-flight LLM insert', async () => {
        const store = new Store(':memory:')
        let releaseFirst!: (value: NotifySummary) => void
        const firstGate = new Promise<NotifySummary>((resolve) => {
            releaseFirst = resolve
        })
        let firstStarted!: () => void
        const firstStartedP = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const recorder = new OverseerEventRecorder(store.events, store.inbox, {
            llmFallback: {
                synthesizeNotifySummary: mock(async () => {
                    firstStarted()
                    return firstGate
                }),
            },
        })
        const live = makeSession('sess-perm', 'cursor')
        const stored = store.sessions.getOrCreateSession('llm-perm', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        live.id = stored.id
        const snapshot = toSessionSnapshot(live, stored.tag)

        const first = recorder.onAgentMessage(snapshot, 'msg-a', agentText('TURN A body'), Date.now())
        await firstStartedP
        live.agentState = {
            requests: {
                req1: { tool: 'Bash', arguments: { command: 'ls' } }
            }
        }
        const perm = recorder.onSessionUpdated(live, stored.tag)
        releaseFirst({ status: 'done', summary: 'llm first' })
        await Promise.all([first, perm])

        const rows = store.events.list().sort((a, b) => a.id - b.id)
        expect(rows.map((row) => row.eventType)).toEqual(['completed', 'approval_requested'])
        expect(rows[0]?.summary).toBe('llm first')
    })
})
