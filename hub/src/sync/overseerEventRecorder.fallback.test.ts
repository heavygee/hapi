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
    it('does not synthesize from assistant text without AGENT_NOTIFY_SUMMARY', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-fb',
            agentText('Refactored the parser and added tests.\n\nMore detail here.'),
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
        expect(store.inbox.count()).toBe(0)
    })

    it('still records a real AGENT_NOTIFY_SUMMARY', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur2', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-real',
            agentText('All done.\nAGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review PR","summary":"Shipped"}'),
            Date.now()
        )

        expect(event?.provenance).toBe('AGENT_NOTIFY_SUMMARY')
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
        expect(store.events.count()).toBe(1)
    })

    it('still records malformed notify as validation_error', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur3', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-bad',
            agentText('Working.\nAGENT_NOTIFY_SUMMARY {not valid json'),
            Date.now()
        )

        expect(event?.eventType).toBe('validation_error')
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
    })

    it('ignores user messages', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur6', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const userContent = { role: 'user', content: { type: 'text', text: 'do the thing' } }
        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-user',
            userContent,
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.count()).toBe(0)
    })

    it('does not synth mid-turn ACP text flushes (multiple messages, no notify)', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const live = store.sessions.getOrCreateSession('cur7', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(live.id, 'cursor'), live.tag)

        expect(recorder.onAgentMessage(snapshot, 'msg-mid-1', agentText('Pulling the last hour of events.'), Date.now())).toBeNull()
        expect(recorder.onAgentMessage(snapshot, 'msg-mid-2', agentText('Found something important.'), Date.now())).toBeNull()
        expect(store.events.count()).toBe(0)
    })
})
