import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
import { OverseerEventRecorder, toSessionSnapshot } from './overseerEventRecorder'

function makeSession(id: string, flavor: string): Session {
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
        serviceTier: null
    }
}

describe('OverseerEventRecorder', () => {
    it('records AGENT_NOTIFY_SUMMARY from codex assistant text', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events)
        const session = store.sessions.getOrCreateSession('test', { flavor: 'codex', path: '/tmp' }, null, 'default')

        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'Done.\n\nAGENT_NOTIFY_SUMMARY {"version":1,"agent":"peer","project":"demo","status":"done","action":"Review PR","summary":"Shipped fix"}'
                }
            }
        }

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'codex')),
            'msg-1',
            content,
            Date.now()
        )

        expect(event?.eventType).toBe('completed')
        expect(event?.attentionCandidate).toBe(1)
        expect(event?.summary).toBe('Shipped fix')
        expect(store.events.count()).toBe(1)
    })

    it('captures done without action as captured-only', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events)
        const session = store.sessions.getOrCreateSession('test2', { flavor: 'claude', path: '/tmp' }, null, 'default')

        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"All good","action":""}'
                }
            }
        }

        const event = recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'claude')),
            'msg-2',
            content,
            Date.now()
        )

        expect(event?.attentionCandidate).toBe(0)
    })

    it('synthesizes approval_requested from permission prompts', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events)
        const session = store.sessions.getOrCreateSession('perm', { flavor: 'claude', path: '/tmp' }, null, 'default')

        const live = makeSession(session.id, 'claude')
        live.agentState = {
            requests: {
                req1: { tool: 'Bash', arguments: { command: 'git push' } }
            }
        }

        recorder.onSessionUpdated(live)

        const events = store.events.list({ eventType: 'approval_requested' })
        expect(events).toHaveLength(1)
        expect(events[0]?.attentionCandidate).toBe(1)
        expect(events[0]?.summary).toContain('Bash')
    })
})
