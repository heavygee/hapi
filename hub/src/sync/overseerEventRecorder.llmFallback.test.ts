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

    it('falls through to heuristic when LLM returns null', async () => {
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

        expect(event?.summary).toBe('First line wins.')
        expect(event?.provenance).toContain('hub-synthesized')
        expect(event?.eventType).toBe('progress')
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

    it('skips LLM when client is not configured (heuristic only)', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('llm4', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-off',
            agentText('Heuristic path.'),
            Date.now()
        )

        expect(event?.provenance).toContain('hub-synthesized')
        expect(event?.summary).toBe('Heuristic path.')
    })

    it('falls through to heuristic when LLM throws', async () => {
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
            agentText('Recovered via heuristic.'),
            Date.now()
        )

        expect(event?.summary).toBe('Recovered via heuristic.')
        expect(event?.provenance).toContain('hub-synthesized')
    })
})
