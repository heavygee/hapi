import { describe, expect, it } from 'bun:test'
import { OVERSEER_STALE_SILENCE_MS } from '@hapi/protocol'
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
    it('records AGENT_NOTIFY_SUMMARY from codex assistant text', async () => {
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

        const event = await recorder.onAgentMessage(
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

    it('captures done without action as captured-only', async () => {
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

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'claude'), session.tag),
            'msg-2',
            content,
            Date.now()
        )

        expect(event?.attentionCandidate).toBe(0)
    })

    it('drops sentinel notify actions from suggested_action and inbox', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('test-sentinel', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'claude'), session.tag),
            'msg-sentinel',
            {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'message',
                        message: 'AGENT_NOTIFY_SUMMARY {"version":1,"status":"blocked","action":"none","summary":"Stuck"}'
                    }
                }
            },
            Date.now()
        )

        expect(event?.attentionCandidate).toBe(1)
        const payload = JSON.parse(event!.payloadJson!) as { suggested_action: string | null }
        expect(payload.suggested_action).toBeNull()
        expect(store.inbox.list({ activeOnly: true })[0]?.suggestedAction).toBeNull()
    })

    it('does not persist hub-inferred stale silence (derive live; no Session Log noise)', () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('idle', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')

        const now = Date.now()
        const silentSince = now - OVERSEER_STALE_SILENCE_MS - 60_000
        const live = makeSession(session.id, 'claude', {
            active: true,
            activeAt: silentSince,
            updatedAt: silentSince
        })

        const emitted = recorder.checkStaleSessions([live], now)

        expect(emitted).toHaveLength(0)
        expect(store.events.count()).toBe(0)
        expect(store.inbox.count()).toBe(0)
    })

    it('synthesizes approval_requested from permission prompts', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('perm', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')

        const live = makeSession(session.id, 'claude')
        live.agentState = {
            requests: {
                req1: { tool: 'Bash', arguments: { command: 'git push' } }
            }
        }

        await recorder.onSessionUpdated(live, session.tag)

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

    it('denormalizes session display name and project into payload.session', async () => {
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

        const event = await recorder.onAgentMessage(
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

    it('ignores placeholder notify.project and keeps path-derived project', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const stored = store.sessions.getOrCreateSession(
            'placeholder',
            { flavor: 'claude', path: '/coding/hapi/worktrees/overseer-summary-emit', host: 'local' },
            null,
            'default'
        )
        const live = makeSession(stored.id, 'claude', {
            metadata: {
                flavor: 'claude',
                path: '/coding/hapi/worktrees/overseer-summary-emit',
                host: 'local'
            }
        })
        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done","action":"","summary":"Turn done"}'
                }
            }
        }

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(live, stored.tag),
            'msg-placeholder',
            content,
            Date.now()
        )

        const payload = JSON.parse(event!.payloadJson!) as {
            session: { project: string | null }
        }
        expect(payload.session.project).toBe('overseer-summary-emit')
        expect(event?.tags).not.toContain('project:<project>')
        expect(event?.tags).not.toContain('agent:<agent-id>')
    })

    it('titles inbox items from payload.session.name after session delete', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const stored = store.sessions.getOrCreateSession(
            'meta-triage',
            { flavor: 'codex', path: '/coding/hapi', name: 'meta HAPI triage', host: 'local' },
            null,
            'default'
        )

        await recorder.onAgentMessage(
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

    it('scoops http(s) URLs into link_seen with artifact_refs kind:url', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('links', { flavor: 'codex', path: '/tmp', host: 'local' }, null, 'default')

        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: [
                        'See https://github.com/tiann/hapi/pull/22 and https://example.com/docs.',
                        '',
                        'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"","summary":"Linked"}'
                    ].join('\n')
                }
            }
        }

        const notify = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'codex'), session.tag),
            'msg-links',
            content,
            Date.now()
        )
        expect(notify?.eventType).toBe('completed')

        const links = store.events.list({ eventType: 'link_seen', sessionId: session.id })
        expect(links).toHaveLength(2)
        expect(links.every((row) => row.attentionCandidate === 0)).toBe(true)
        expect(links.every((row) => row.relatedSessionId === session.id)).toBe(true)

        const refs = links.map((row) => JSON.parse(row.artifactRefs!) as Array<{ kind: string; url: string }>)
        const urls = refs.flatMap((arr) => arr.map((item) => item.url)).sort()
        expect(urls).toEqual([
            'https://example.com/docs',
            'https://github.com/tiann/hapi/pull/22'
        ])
        expect(refs.every((arr) => arr.every((item) => item.kind === 'url'))).toBe(true)

        const payload = JSON.parse(links[0]!.payloadJson!) as { session: { id: string }; url: string }
        expect(payload.session.id).toBe(session.id)
    })

    it('idempotently scoops the same URL from the same message once', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('dedupe', { flavor: 'claude', path: '/tmp', host: 'local' }, null, 'default')
        const content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'https://example.com/a https://example.com/a'
                }
            }
        }
        const snapshot = toSessionSnapshot(makeSession(session.id, 'claude'), session.tag)
        await recorder.onAgentMessage(snapshot, 'msg-dup', content, Date.now())
        await recorder.onAgentMessage(snapshot, 'msg-dup', content, Date.now())
        expect(store.events.list({ eventType: 'link_seen' })).toHaveLength(1)
    })

    it('records AGENT_NOTIFY_SUMMARY from user-role peer deliveries (hapi-ping-peer)', async () => {
        const store = new Store(':memory:')
        const recorder = new OverseerEventRecorder(store.events, store.inbox)
        const session = store.sessions.getOrCreateSession('peer-recv', { flavor: 'cursor', path: '/tmp', host: 'local' }, null, 'default')

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: [
                    'From: Peer #1717: blocked list UX',
                    '',
                    'LEASE: already released.',
                    '',
                    'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"idle until dogfood","summary":"lease confirmed released; standing down"}'
                ].join('\n')
            }
        }

        const event = await recorder.onAgentMessage(
            toSessionSnapshot(makeSession(session.id, 'cursor'), session.tag),
            'msg-peer-ping',
            content,
            Date.now()
        )

        expect(event?.eventType).toBe('completed')
        expect(event?.summary).toBe('lease confirmed released; standing down')
        expect(event?.provenance).toBe('AGENT_NOTIFY_SUMMARY (user-role delivery)')
        const payload = JSON.parse(event!.payloadJson!) as {
            messageId: string
            deliveryRole?: string
            notify_summary: { status?: string }
        }
        expect(payload.messageId).toBe('msg-peer-ping')
        expect(payload.deliveryRole).toBe('user')
        expect(payload.notify_summary.status).toBe('done')
    })
})
