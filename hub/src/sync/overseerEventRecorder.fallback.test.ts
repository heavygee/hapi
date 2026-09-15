import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
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

describe('OverseerEventRecorder — no hub text synth', () => {
    it('does not synthesize from assistant text without AGENT_NOTIFY_SUMMARY', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-fb',
            agentText('Refactored the parser and added tests.\n\nMore detail here.'),
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
        expect(store.inbox.count()).toBe(0)
    })

    it('still records a real AGENT_NOTIFY_SUMMARY', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur2', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-real',
            agentText('All done.\nAGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review PR","summary":"Shipped"}'),
            Date.now()
        )

        expect(event?.provenance).toBe('AGENT_NOTIFY_SUMMARY')
        expect(store.events.count()).toBe(1)
    })

    it('does not synth mid-turn ACP text flushes', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const live = store.sessions.getOrCreateSession('cur7', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(live.id, 'cursor'), live.tag)

        expect(await recorder.onAgentMessage(snapshot, 'msg-mid-1', agentText('Pulling events.'), Date.now(), { thinking: true })).toBeNull()
        expect(await recorder.onAgentMessage(snapshot, 'msg-mid-2', agentText('Found something.'), Date.now(), { thinking: true })).toBeNull()
        expect(store.events.count()).toBe(0)
    })
})
