import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOOL_RESULT_CHARS, clampToolResult, runOverseerConverse } from './converse'
import { BrainUnavailableError, type BrainConfig } from './brainClient'
import type { OverseerEntity } from '../sync/overseerEntity'

const originalFetch = globalThis.fetch
function setFetch(mock: unknown) {
    globalThis.fetch = mock as typeof globalThis.fetch
}

const config: BrainConfig = { baseUrl: 'http://brain.test/v1', model: 'main', timeoutMs: 5000 }

const fakeOverseer = {
    queryInbox: () => ({ total: 1, items: [{ id: 7, title: 'CI blocking 3 workers' }] }),
    listActiveWorkers: () => ({ workers: [{ sessionId: 'sess-web', name: 'web refactor', observedState: 'stale' }] }),
    queryEvents: () => [],
    getSessionState: () => ({ sessionId: 'x' }),
    getSessionRecentOutput: () => ({ chunks: [] }),
    getWorkerHealth: () => ({ sessionId: 'x' }),
    explainPriority: () => ({ inboxItemId: 1 })
} as unknown as OverseerEntity

function chatResponse(message: unknown) {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    })
}

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('clampToolResult', () => {
    it('passes small results through unchanged', () => {
        const small = JSON.stringify({ items: [1, 2, 3] })
        expect(clampToolResult(small)).toBe(small)
    })

    it('truncates an oversized result and appends a narrow-your-query note', () => {
        const huge = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => ({ id: i, title: 'x'.repeat(40) })) })
        expect(huge.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS)
        const clamped = clampToolResult(huge)
        expect(clamped.length).toBeLessThan(huge.length)
        expect(clamped.startsWith(huge.slice(0, 100))).toBe(true)
        expect(clamped).toContain('truncated')
    })
})

describe('runOverseerConverse', () => {
    it('runs a tool call then returns the final answer', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_inbox', arguments: '{"limit":10}' } }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'One item needs your attention: CI is blocking 3 workers.'
            }))
        setFetch(fetchMock)

        const { reply, toolTrace } = await runOverseerConverse({
            overseer: fakeOverseer,
            config,
            messages: [{ role: 'operator', content: 'What needs my attention?' }]
        })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(toolTrace).toHaveLength(1)
        expect(toolTrace[0]).toMatchObject({ tool: 'query_inbox', ok: true })
        expect(reply).toContain('CI is blocking 3 workers')
    })

    it('records a failed tool call but keeps going', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'explain_priority', arguments: '{"itemId":-1}' } }]
            }))
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'That item id was invalid.' }))
        setFetch(fetchMock)

        const { reply, toolTrace } = await runOverseerConverse({
            overseer: fakeOverseer,
            config,
            messages: [{ role: 'operator', content: 'why is item -1 flagged?' }]
        })

        expect(toolTrace[0]?.ok).toBe(false)
        expect(reply).toContain('invalid')
    })

    it('ignores an unknown tool name', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'dispatch_now', arguments: '{}' } }]
            }))
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'I cannot dispatch at Stage 0.' }))
        setFetch(fetchMock)

        const { toolTrace } = await runOverseerConverse({
            overseer: fakeOverseer,
            config,
            messages: [{ role: 'operator', content: 'restart it' }]
        })

        expect(toolTrace[0]).toMatchObject({ ok: false, error: 'unknown tool' })
    })

    it('nudges once when the first answer skips tools, then grounds', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'The inbox is empty.' }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_inbox', arguments: '{}' } }]
            }))
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'One item needs your attention.' }))
        setFetch(fetchMock)

        const { reply, toolTrace } = await runOverseerConverse({
            overseer: fakeOverseer,
            config,
            messages: [{ role: 'operator', content: 'what needs my attention?' }]
        })

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(toolTrace.map((t) => t.tool)).toEqual(['query_inbox'])
        expect(reply).toContain('needs your attention')
    })

    it('accepts a genuine no-tool answer after one nudge', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'Hi.' }))
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'Hello — I can advise on your fleet.' }))
        setFetch(fetchMock)

        const { reply, toolTrace } = await runOverseerConverse({
            overseer: fakeOverseer,
            config,
            messages: [{ role: 'operator', content: 'hi' }]
        })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(toolTrace).toHaveLength(0)
        expect(reply).toBe('Hello — I can advise on your fleet.')
    })

    it('surfaces brain unavailability (unreachable)', async () => {
        setFetch(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
        try {
            await runOverseerConverse({ overseer: fakeOverseer, config, messages: [{ role: 'operator', content: 'hi' }] })
            throw new Error('should have thrown')
        } catch (e) {
            expect(e).toBeInstanceOf(BrainUnavailableError)
            expect((e as BrainUnavailableError).kind).toBe('unreachable')
            expect((e as BrainUnavailableError).reachable).toBe(false)
        }
    })

    it('classifies an http error as reachable (template 400 is not offline)', async () => {
        setFetch(vi.fn().mockResolvedValue(new Response('error loading template: tool_call_id', { status: 400 })))
        try {
            await runOverseerConverse({ overseer: fakeOverseer, config, messages: [{ role: 'operator', content: 'hi' }] })
            throw new Error('should have thrown')
        } catch (e) {
            expect(e).toBeInstanceOf(BrainUnavailableError)
            expect((e as BrainUnavailableError).kind).toBe('http')
            expect((e as BrainUnavailableError).status).toBe(400)
            expect((e as BrainUnavailableError).reachable).toBe(true)
        }
    })

    it('marks ping_session ok:false in the tool trace when relay fails', async () => {
        const overseer = {
            ...fakeOverseer,
            pingSession: async () => ({
                ok: false,
                sessionId: 'sess-1',
                sessionName: null,
                project: null,
                resumed: false,
                tombstone: 'Failed to relay: session_not_found',
                error: 'session_not_found'
            })
        } as unknown as OverseerEntity
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'ping_session', arguments: '{"sessionId":"sess-1","message":"hi"}' }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({ role: 'assistant', content: 'Could not reach that session.' }))
        setFetch(fetchMock)

        const { toolTrace } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'ping session sess-1: "hi"' }],
            focus: {
                sessionId: 'sess-1',
                itemId: null,
                source: 'tool_resolve',
                updatedAt: 1
            }
        })

        expect(toolTrace[0]).toMatchObject({
            tool: 'ping_session',
            ok: false,
            error: 'session_not_found'
        })
    })

    it('keeps successful relay in the tool trace when the follow-up brain call fails', async () => {
        const overseer = {
            ...fakeOverseer,
            pingSession: async () => ({
                ok: true,
                sessionId: 'new-id',
                sessionName: 'Worker',
                project: 'hapi',
                resumed: true,
                tombstone: 'Relayed to Worker (new-id00) [resumed]: "please continue"'
            })
        } as unknown as OverseerEntity
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'ping_session', arguments: '{"sessionId":"old-id","message":"please continue"}' }
                }]
            }))
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        setFetch(fetchMock)

        const { reply, toolTrace } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'ping session old-id: "please continue"' }],
            focus: {
                sessionId: 'old-id',
                itemId: null,
                source: 'tool_resolve',
                updatedAt: 1
            }
        })

        expect(toolTrace).toHaveLength(1)
        expect(toolTrace[0]).toMatchObject({ tool: 'ping_session', ok: true })
        expect(reply).toContain('already succeeded')
        expect(reply).toContain('Relayed to Worker')
        expect(reply).toContain('Do not retry')
    })

    it('refuses ping_session when there is no conversational focus and no allowWrites', async () => {
        const pingSession = vi.fn()
        const overseer = {
            ...fakeOverseer,
            pingSession
        } as unknown as OverseerEntity
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'ping_session', arguments: '{"sessionId":"sess-1","message":"hi"}' }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'I cannot relay without conversational focus.'
            }))
        setFetch(fetchMock)

        const { toolTrace } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'what needs my attention?' }]
        })

        expect(pingSession).not.toHaveBeenCalled()
        expect(toolTrace[0]).toMatchObject({ tool: 'ping_session', ok: false })
        expect(toolTrace[0]?.error).toMatch(/not authorized|no conversational focus/i)
    })

    it('authorizes anaphoric ping_session from hub focus without ids in the follow-up line', async () => {
        const sessionId = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const pingSession = vi.fn(async () => ({
            ok: true,
            sessionId,
            sessionName: 'W1.8 worker',
            project: 'hapi',
            resumed: true,
            tombstone: `Relayed to W1.8 worker (${sessionId.slice(0, 8)}) [resumed]: "go ahead"`
        }))
        const overseer = {
            ...fakeOverseer,
            pingSession
        } as unknown as OverseerEntity
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: {
                        name: 'ping_session',
                        arguments: JSON.stringify({
                            sessionId,
                            itemId: 118,
                            message: 'go ahead — tear down and rebuild is fine'
                        })
                    }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Relayed to the W1.8 worker.'
            }))
        setFetch(fetchMock)

        const { toolTrace, focus } = await runOverseerConverse({
            overseer,
            config,
            messages: [{
                role: 'operator',
                content: 'tell it to go ahead - explain tear down and rebuild is the point'
            }],
            focus: {
                sessionId,
                itemId: 118,
                source: 'tool_resolve',
                updatedAt: 1
            }
        })

        expect(pingSession).toHaveBeenCalledOnce()
        expect(toolTrace[0]).toMatchObject({ tool: 'ping_session', ok: true })
        expect(focus?.sessionId).toBe(sessionId)
        expect(focus?.itemId).toBe(118)
    })

    it('sets focus from explain_priority and keeps multi-item inbox dumps from retargeting', async () => {
        const sessionId = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const overseer = {
            ...fakeOverseer,
            explainPriority: () => ({
                inboxItemId: 118,
                relatedSessionId: sessionId,
                title: 'W1.8 acceptance'
            }),
            queryInbox: () => ({
                items: [
                    { id: 1, title: 'noise', relatedSessionId: '96f67085-1111-2222-3333-444455556666' },
                    { id: 118, title: 'W1.8', relatedSessionId: sessionId }
                ],
                candidates: [],
                surfaced: [],
                held: []
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'explain_priority', arguments: '{"itemId":118}' }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c2',
                    type: 'function',
                    function: { name: 'query_inbox', arguments: '{"limit":25}' }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Item 118 is the W1.8 worker.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'query it then' }],
            focus: null
        })

        expect(focus?.itemId).toBe(118)
        expect(focus?.sessionId).toBe(sessionId)
        expect(focus?.source).toBe('tool_resolve')
    })

    it('persists mid-turn tool focus for the next turn but does not unlock same-turn writes', async () => {
        const sessionId = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const pingSession = vi.fn(async () => ({
            ok: true,
            sessionId,
            sessionName: 'W1.8',
            project: 'hapi',
            resumed: true,
            tombstone: 'Relayed'
        }))
        const overseer = {
            ...fakeOverseer,
            explainPriority: () => ({
                inboxItemId: 118,
                relatedSessionId: sessionId,
                title: 'W1.8'
            }),
            pingSession
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'explain_priority', arguments: '{"itemId":118}' }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c2',
                    type: 'function',
                    function: {
                        name: 'ping_session',
                        arguments: JSON.stringify({
                            sessionId,
                            itemId: 118,
                            message: 'go ahead'
                        })
                    }
                }]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Need focus from a prior turn to relay.'
            }))
        setFetch(fetchMock)

        const { toolTrace, focus } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'tell it to go ahead' }],
            focus: null
        })

        expect(toolTrace.find((t) => t.tool === 'explain_priority')?.ok).toBe(true)
        expect(toolTrace.find((t) => t.tool === 'ping_session')?.ok).toBe(false)
        expect(pingSession).not.toHaveBeenCalled()
        // Focus is ready for the *next* operator turn.
        expect(focus?.itemId).toBe(118)
        expect(focus?.sessionId).toBe(sessionId)
    })

    it('does not last-win when multiple distinct subjects resolve in one turn', async () => {
        const sessionA = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const sessionB = '96f67085-1111-2222-3333-444455556666'
        const overseer = {
            ...fakeOverseer,
            getSessionState: ({ sessionId }: { sessionId: string }) => ({
                state: { sessionId, name: sessionId.slice(0, 8), active: true }
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'c1',
                        type: 'function',
                        function: {
                            name: 'get_session_state',
                            arguments: JSON.stringify({ sessionId: sessionA })
                        }
                    },
                    {
                        id: 'c2',
                        type: 'function',
                        function: {
                            name: 'get_session_state',
                            arguments: JSON.stringify({ sessionId: sessionB })
                        }
                    }
                ]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Compared both workers.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'compare these two workers' }],
            focus: null
        })

        expect(focus).toBeNull()
    })

    it('treats re-resolving turn-start focus plus another subject as multi-subject', async () => {
        const sessionA = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const sessionB = '96f67085-1111-2222-3333-444455556666'
        const entity = {
            ...fakeOverseer,
            getSessionState: (sessionId: string) => ({
                sessionId,
                name: sessionId.slice(0, 8),
                active: true
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'c1',
                        type: 'function',
                        function: {
                            name: 'get_session_state',
                            arguments: JSON.stringify({ sessionId: sessionA })
                        }
                    },
                    {
                        id: 'c2',
                        type: 'function',
                        function: {
                            name: 'get_session_state',
                            arguments: JSON.stringify({ sessionId: sessionB })
                        }
                    }
                ]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Compared A and B.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer: entity,
            config,
            messages: [{ role: 'operator', content: 'compare A and B' }],
            focus: {
                sessionId: sessionA,
                itemId: null,
                source: 'client',
                updatedAt: 1
            }
        })

        // Multi-subject → retain turn-start A, do not last-win to B
        expect(focus?.sessionId).toBe(sessionA)
    })

    it('keeps focus when inbox item and same-session probe are compatible', async () => {
        const sessionA = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const entity = {
            ...fakeOverseer,
            queryInbox: () => ({
                items: [{ id: 1, title: 'one', relatedSessionId: sessionA }],
                candidates: [],
                surfaced: [],
                held: []
            }),
            getSessionState: (sessionId: string) => ({
                sessionId,
                name: 'W1.8',
                active: true
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'c1',
                        type: 'function',
                        function: { name: 'query_inbox', arguments: '{"limit":1}' }
                    },
                    {
                        id: 'c2',
                        type: 'function',
                        function: {
                            name: 'get_session_state',
                            arguments: JSON.stringify({ sessionId: sessionA })
                        }
                    }
                ]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Same worker.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer: entity,
            config,
            messages: [{ role: 'operator', content: 'look at the one inbox item then its health' }],
            focus: null
        })

        expect(focus?.sessionId).toBe(sessionA)
        expect(focus?.itemId).toBe(1)
    })

    it('treats two different inbox items on the same session as multi-subject', async () => {
        const sessionA = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const entity = {
            ...fakeOverseer,
            explainPriority: ({ itemId }: { itemId: number }) => ({
                inboxItemId: itemId,
                relatedSessionId: sessionA,
                title: `item-${itemId}`
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'c1',
                        type: 'function',
                        function: { name: 'explain_priority', arguments: '{"itemId":1}' }
                    },
                    {
                        id: 'c2',
                        type: 'function',
                        function: { name: 'explain_priority', arguments: '{"itemId":2}' }
                    }
                ]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Compared both items.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer: entity,
            config,
            messages: [{ role: 'operator', content: 'compare item 1 and 2' }],
            focus: null
        })

        expect(focus).toBeNull()
    })

    it('still retargets when a non-retargeting read precedes a real subject change', async () => {
        const sessionA = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const sessionB = '96f67085-1111-2222-3333-444455556666'
        const overseer = {
            ...fakeOverseer,
            queryInbox: () => ({
                items: [
                    { id: 1, title: 'noise', relatedSessionId: sessionA },
                    { id: 2, title: 'other', relatedSessionId: sessionB }
                ],
                candidates: [],
                surfaced: [],
                held: []
            }),
            explainPriority: () => ({
                inboxItemId: 99,
                relatedSessionId: sessionB,
                title: 'B'
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'c1',
                        type: 'function',
                        function: { name: 'query_inbox', arguments: '{"limit":10}' }
                    },
                    {
                        id: 'c2',
                        type: 'function',
                        function: { name: 'explain_priority', arguments: '{"itemId":99}' }
                    }
                ]
            }))
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: 'Focused on B.'
            }))
        setFetch(fetchMock)

        const { focus } = await runOverseerConverse({
            overseer,
            config,
            messages: [{ role: 'operator', content: 'look at inbox then explain 99' }],
            focus: {
                sessionId: sessionA,
                itemId: 1,
                source: 'tool_resolve',
                updatedAt: 1
            }
        })

        expect(focus?.sessionId).toBe(sessionB)
        expect(focus?.itemId).toBe(99)
    })

    it('attaches mid-turn focus onto BrainUnavailableError after a resolving tool', async () => {
        const sessionId = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
        const overseer = {
            ...fakeOverseer,
            explainPriority: () => ({
                inboxItemId: 118,
                relatedSessionId: sessionId,
                title: 'W1.8'
            })
        } as unknown as OverseerEntity

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(chatResponse({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'explain_priority', arguments: '{"itemId":118}' }
                }]
            }))
            .mockRejectedValueOnce(new TypeError('fetch failed'))
        setFetch(fetchMock)

        try {
            await runOverseerConverse({
                overseer,
                config,
                messages: [{ role: 'operator', content: 'what is item 118?' }],
                focus: null
            })
            expect.unreachable('should have thrown')
        } catch (error) {
            expect(error).toBeInstanceOf(BrainUnavailableError)
            const brainErr = error as BrainUnavailableError
            expect(brainErr.converseFocus?.itemId).toBe(118)
            expect(brainErr.converseFocus?.sessionId).toBe(sessionId)
        }
    })
})
