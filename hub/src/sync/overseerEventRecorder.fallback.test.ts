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
    it('synthesizes a session-log-only progress event when no summary line', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
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

        const payload = JSON.parse(event!.payloadJson!) as { synthesized?: boolean; synthesis?: string }
        expect(payload.synthesized).toBe(true)
        expect(payload.synthesis).toBe('heuristic')

        // Session log gets it; the attention inbox stays empty.
        expect(store.events.count()).toBe(1)
        expect(store.inbox.count()).toBe(0)
    })

    it('does not synthesize when a real AGENT_NOTIFY_SUMMARY is present', async () => {
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
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
        expect(store.events.count()).toBe(1)
    })

    it('does not synthesize when the summary line is malformed (validation_error wins)', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur3', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-bad',
            agentText('Working.\nAGENT_NOTIFY_SUMMARY {not valid json'),
            Date.now()
        )

        expect(event?.eventType).toBe('validation_error')
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
    })

    it('is idempotent for a redelivered message id', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur4', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')
        const snapshot = toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag)

        await recorder.onAgentMessage(snapshot, 'msg-dup', agentText('Progress update.'), Date.now())
        await recorder.onAgentMessage(snapshot, 'msg-dup', agentText('Progress update.'), Date.now())

        expect(store.events.list({ eventType: 'progress' })).toHaveLength(1)
    })

    it('caps a long first line with an ellipsis', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur5', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const longLine = 'x'.repeat(500)
        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-long',
            agentText(longLine),
            Date.now()
        )

        expect(event?.summary?.length).toBe(200)
        expect(event?.summary?.endsWith('\u2026')).toBe(true)
    })

    it('ignores user messages', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('cur6', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const userContent = { role: 'user', content: { type: 'text', text: 'do the thing' } }
        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-user',
            userContent,
            Date.now()
        )

        expect(event).toBeNull()
        expect(store.events.list({ eventType: 'progress' })).toHaveLength(0)
    })
})
