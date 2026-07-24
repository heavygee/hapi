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

describe('OverseerEventRecorder turn fallback', () => {
    it('synthesizes a session-log-only progress event when no summary line', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-fb',
            agentText('Refactored the parser and added tests.\n\nMore detail here.'),
            Date.now()
        )

        expect(event).not.toBeNull()
        expect(event?.eventType).toBe('progress')
        expect(event?.attentionCandidate).toBe(0)
        expect(event?.operatorActionRequired).toBe(0)
        expect(event?.summary).toBe('Refactored the parser and added tests.')
        expect(event?.provenance).toContain('hub-synthesized')

        const payload = JSON.parse(event!.payloadJson!) as { synthesized?: boolean }
        expect(payload.synthesized).toBe(true)

        // Session log gets it; the attention inbox stays empty.
        expect(store.events.count()).toBe(1)
        expect(store.inbox.count()).toBe(0)
    })

    it('does not synthesize when a real AGENT_NOTIFY_SUMMARY is present', () => {
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

    it('does not synthesize when the summary line is malformed (validation_error wins)', () => {
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

    it('is idempotent for a redelivered message id', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur4', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag)

        recorder.onAgentMessage(snapshot, 'msg-dup', agentText('Progress update.'), Date.now())
        recorder.onAgentMessage(snapshot, 'msg-dup', agentText('Progress update.'), Date.now())

        expect(store.events.list({ eventType: 'progress' })).toHaveLength(1)
    })

    it('caps a long first line with an ellipsis', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur5', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const longLine = 'x'.repeat(500)
        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-long',
            agentText(longLine),
            Date.now()
        )

        expect(event?.summary?.length).toBe(200)
        expect(event?.summary?.endsWith('\u2026')).toBe(true)
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
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
    })

    it('defers synth while thinking; flushes once when thinking clears', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const live = store.sessions.getOrCreateSession('cur7', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(live.id, 'cursor'), live.tag)

        // Mid-turn ACP text flushes (tool boundaries) — must NOT synth yet.
        expect(recorder.onAgentMessage(snapshot, 'msg-mid-1', agentText('Pulling the last hour of events.'), Date.now(), { thinking: true })).toBeNull()
        expect(recorder.onAgentMessage(snapshot, 'msg-mid-2', agentText('Found something important.'), Date.now(), { thinking: true })).toBeNull()
        expect(store.events.count()).toBe(0)

        // End of turn: thinking true → false.
        recorder.onSessionUpdated(makeSession(live.id, 'cursor', { thinking: true }), live.tag)
        recorder.onSessionUpdated(makeSession(live.id, 'cursor', { thinking: false }), live.tag)

        const events = store.events.list({ eventType: 'progress' })
        expect(events).toHaveLength(1)
        expect(events[0]?.summary).toBe('Found something important.')
        expect(events[0]?.provenance).toContain('hub-synthesized')
        const payload = JSON.parse(events[0]!.payloadJson!) as { messageId?: string }
        expect(payload.messageId).toBe('msg-mid-2')
    })

    it('does not flush deferred synth when a real notify arrives mid-turn', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const live = store.sessions.getOrCreateSession('cur8', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(live.id, 'cursor'), live.tag)

        recorder.onAgentMessage(snapshot, 'msg-mid', agentText('Working on it.'), Date.now(), { thinking: true })
        const emit = recorder.onAgentMessage(
            snapshot,
            'msg-final',
            agentText('Done.\nAGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review","summary":"Shipped"}'),
            Date.now(),
            { thinking: true }
        )
        expect(emit?.provenance).toBe('AGENT_NOTIFY_SUMMARY')

        recorder.onSessionUpdated(makeSession(live.id, 'cursor', { thinking: true }), live.tag)
        recorder.onSessionUpdated(makeSession(live.id, 'cursor', { thinking: false }), live.tag)

        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
        expect(store.events.count()).toBe(1)
    })
})
