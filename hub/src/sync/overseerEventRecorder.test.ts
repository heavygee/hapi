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

describe('OverseerEventRecorder', () => {
    it('records AGENT_NOTIFY_SUMMARY from codex assistant text', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('test', { flavor: 'codex', path: '/tmp', host: 'local' }, null, 'default')

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
            toSessionSnapshot(makeSession(session.id, 'codex'), session.tag),
            'msg-1',
            content,
            Date.now()
        )

        expect(event?.eventType).toBe('completed')
        expect(event?.attentionCandidate).toBe(1)
        expect(event?.summary).toBe('Shipped fix')
        expect(store.events.count()).toBe(1)

        const payload = JSON.parse(event!.payloadJson!) as {
            session: { id: string; tag: string | null; name: string | null; project: string | null; flavor: string }
            notify_summary: { project?: string }
        }
        expect(payload.session.id).toBe(session.id)
        expect(payload.session.tag).toBe('test')
        expect(payload.session.project).toBe('demo')
        expect(payload.session.flavor).toBe('codex')

        expect(store.inbox.count()).toBe(1)
        const item = store.inbox.list({ activeOnly: true })[0]
        expect(item?.category).toBe('FINALE')
        expect(item?.sourceEventIds).toEqual([event!.id])
        expect(item?.title).toBe('test')
    })

    it('captures done without action as captured-only', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('test2', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')

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
            toSessionSnapshot(makeSession(session.id, 'claude'), session.tag),
            'msg-2',
            content,
            Date.now()
        )

        expect(event?.attentionCandidate).toBe(0)
    })

    it('synthesizes approval_requested from permission prompts', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('perm', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')

        const live = makeSession(session.id, 'claude')
        live.agentState = {
            requests: {
                req1: { tool: 'Bash', arguments: { command: 'git push' } }
            }
        }

        recorder.onSessionUpdated(live, session.tag)

        const events = store.events.list({ eventType: 'approval_requested' })
        expect(events).toHaveLength(1)
        expect(events[0]?.attentionCandidate).toBe(1)
        expect(events[0]?.summary).toContain('Bash')

        const payload = JSON.parse(events[0]!.payloadJson!) as { session: { name: string | null } }
        expect(payload.session.name).toBe('perm')
        expect(store.inbox.count()).toBe(1)
        expect(store.inbox.list()[0]?.category).toBe('APPROVAL')
        expect(store.inbox.list()[0]?.title).toBe('perm')
    })

    it('denormalizes session display name and project into payload.session', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const stored = store.sessions.getOrCreateSession(
            'meta-triage',
            { flavor: 'codex', path: '/coding/hapi', name: 'meta HAPI triage', host: 'local' },
            null,
            'default'
        )
        const live = makeSession(stored.id, 'codex', {
            metadata: { flavor: 'codex', path: '/coding/hapi', name: 'meta HAPI triage', host: 'local' }
        })

        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"overseer","project":"hapi","status":"done","action":"","summary":"Triage complete"}'
                }
            }
        }

        const event = recorder.onAgentMessage(
            toSessionSnapshot(live, stored.tag),
            'msg-meta',
            content,
            Date.now()
        )

        const payload = JSON.parse(event!.payloadJson!) as {
            session: { id: string; tag: string | null; name: string | null; project: string | null; flavor: string }
        }
        expect(payload.session.name).toBe('meta HAPI triage')
        expect(payload.session.tag).toBe('meta-triage')
        expect(payload.session.project).toBe('hapi')
        expect(payload.session.flavor).toBe('codex')
        expect(payload.session.id).toBe(stored.id)
    })

    it('titles inbox items from payload.session.name after session delete', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const stored = store.sessions.getOrCreateSession(
            'meta-triage',
            { flavor: 'codex', path: '/coding/hapi', name: 'meta HAPI triage', host: 'local' },
            null,
            'default'
        )

        recorder.onAgentMessage(
            toSessionSnapshot(makeSession(stored.id, 'codex', {
                metadata: { flavor: 'codex', path: '/coding/hapi', name: 'meta HAPI triage', host: 'local' }
            }), stored.tag),
            'msg-attn',
            {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'message',
                        message: 'AGENT_NOTIFY_SUMMARY {"version":1,"status":"blocked","action":"Fix CI","summary":"CI failed"}'
                    }
                }
            },
            Date.now()
        )

        const itemBefore = store.inbox.list()[0]
        expect(itemBefore?.title).toBe('meta HAPI triage')

        expect(store.sessions.deleteSession(stored.id, 'default')).toBe(true)

        const itemAfter = store.inbox.getById(itemBefore!.id)
        expect(itemAfter?.title).toBe('meta HAPI triage')
        expect(itemAfter?.relatedSessionId).toBeNull()
    })
})
