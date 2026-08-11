import { describe, expect, it } from 'vitest'
import {
    applyFocusFromClientSession,
    applyFocusFromToolResolve,
    formatConverseFocusDirective,
    hasConverseFocusSubject,
    parseConverseFocus,
    type OverseerConverseFocus
} from './overseerConverseFocus'
import {
    isWriteToolCallAuthorized,
    resolveOverseerWriteAuthorization
} from './overseerWriteIntent'

const SESSION_A = '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff'
const SESSION_B = '96f67085-1111-2222-3333-444455556666'

function focus(partial: Partial<OverseerConverseFocus> = {}): OverseerConverseFocus {
    return {
        sessionId: SESSION_A,
        itemId: 118,
        source: 'tool_resolve',
        updatedAt: 1_700_000_000_000,
        ...partial
    }
}

describe('hub-owned conversational focus (capability, not pattern matching)', () => {
    it('authorizes natural-language action against established focus without ids in the utterance', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'tell it to go ahead - explain we can tear down and rebuild',
            focus: focus()
        })
        expect([...auth.allowed]).toContain('ping_session')
        expect(
            isWriteToolCallAuthorized(
                'ping_session',
                { sessionId: SESSION_A, itemId: 118, message: 'go ahead - tear down ok' },
                auth
            ).ok
        ).toBe(true)
        expect(
            isWriteToolCallAuthorized(
                'ping_session',
                { sessionId: SESSION_B, message: 'go ahead' },
                auth
            ).ok
        ).toBe(false)
    })

    it('updates focus from a successful subject-resolving tool; subject change replaces prior focus', () => {
        const afterExplain = applyFocusFromToolResolve(null, {
            tool: 'explain_priority',
            ok: true,
            args: { itemId: 118 },
            result: {
                explanation: {
                    inboxItemId: 118,
                    relatedSessionId: SESSION_A,
                    title: 'W1.8 acceptance'
                }
            }
        })
        expect(afterExplain).toEqual(
            expect.objectContaining({
                itemId: 118,
                sessionId: SESSION_A,
                source: 'tool_resolve'
            })
        )

        const changed = applyFocusFromToolResolve(afterExplain, {
            tool: 'explain_priority',
            ok: true,
            args: { itemId: 99 },
            result: {
                explanation: {
                    inboxItemId: 99,
                    relatedSessionId: SESSION_B,
                    title: 'other'
                }
            }
        })
        expect(changed?.itemId).toBe(99)
        expect(changed?.sessionId).toBe(SESSION_B)
    })

    it('does not retarget focus from multi-item tool dumps (injection surface)', () => {
        const still = applyFocusFromToolResolve(focus(), {
            tool: 'query_inbox',
            ok: true,
            args: { limit: 25 },
            result: {
                items: [
                    {
                        id: 999,
                        relatedSessionId: SESSION_B,
                        title: 'cursor inline model-error detect'
                    },
                    { id: 118, relatedSessionId: SESSION_A, title: 'W1.8' }
                ]
            }
        })
        expect(still?.sessionId).toBe(SESSION_A)
        expect(still?.itemId).toBe(118)
    })

    it('seeds focus from explicit client session id, not from operator prose grepping', () => {
        const seeded = applyFocusFromClientSession(null, SESSION_A)
        expect(seeded).toEqual(
            expect.objectContaining({ sessionId: SESSION_A, itemId: null, source: 'client' })
        )
        const replaced = applyFocusFromClientSession(focus(), SESSION_B)
        expect(replaced?.sessionId).toBe(SESSION_B)
        expect(replaced?.itemId).toBeNull()
    })

    it('does not adopt null session probes or model-arg-only recent_output', () => {
        expect(
            applyFocusFromToolResolve(focus(), {
                tool: 'get_session_state',
                ok: true,
                args: { sessionId: SESSION_B },
                result: { state: null }
            })
        ).toEqual(focus())

        expect(
            applyFocusFromToolResolve(null, {
                tool: 'get_session_recent_output',
                ok: true,
                args: { sessionId: SESSION_B },
                result: { chunks: [] }
            })
        ).toBeNull()

        const resolved = applyFocusFromToolResolve(null, {
            tool: 'get_session_state',
            ok: true,
            args: { sessionId: 'short' },
            result: { state: { sessionId: SESSION_A, name: 'W1.8' } }
        })
        expect(resolved?.sessionId).toBe(SESSION_A)
    })

    it('formats a focus directive for the brain assemble path', () => {
        const line = formatConverseFocusDirective(focus())
        expect(line).toContain('118')
        expect(line).toContain(SESSION_A)
        expect(line.toLowerCase()).toMatch(/focus|subject/)
    })

    it('promotes singleton list_active_workers roster to focus', () => {
        const next = applyFocusFromToolResolve(null, {
            tool: 'list_active_workers',
            ok: true,
            args: {},
            result: {
                workers: [{ sessionId: SESSION_A, name: 'W1.8', observedState: 'working' }]
            }
        })
        expect(next).toEqual(
            expect.objectContaining({
                sessionId: SESSION_A,
                itemId: null,
                source: 'tool_resolve'
            })
        )
        expect(
            applyFocusFromToolResolve(focus(), {
                tool: 'list_active_workers',
                ok: true,
                args: {},
                result: {
                    workers: [
                        { sessionId: SESSION_A, name: 'a' },
                        { sessionId: SESSION_B, name: 'b' }
                    ]
                }
            })
        ).toEqual(focus())
    })

    it('replaces the whole focus pair on subject-changing writes', () => {
        const afterPing = applyFocusFromToolResolve(focus(), {
            tool: 'ping_session',
            ok: true,
            args: { sessionId: SESSION_B, message: 'retry' },
            result: { ok: true, sessionId: SESSION_B }
        })
        expect(afterPing).toEqual(
            expect.objectContaining({
                sessionId: SESSION_B,
                itemId: null,
                source: 'tool_resolve'
            })
        )
        const afterDisp = applyFocusFromToolResolve(focus(), {
            tool: 'record_disposition',
            ok: true,
            args: { itemId: 99, action: 'done' },
            result: { ok: true, itemId: 99 }
        })
        expect(afterDisp).toEqual(
            expect.objectContaining({
                sessionId: null,
                itemId: 99,
                source: 'tool_resolve'
            })
        )
    })

    it('does not promote an ungranted itemId from a successful ping', () => {
        const after = applyFocusFromToolResolve(focus(), {
            tool: 'ping_session',
            ok: true,
            args: { sessionId: SESSION_A, itemId: 999, message: 'hi' },
            result: { ok: true, sessionId: SESSION_A }
        })
        expect(after?.sessionId).toBe(SESSION_A)
        expect(after?.itemId).toBe(118)
    })

    it('promotes singleton query_events to focus', () => {
        expect(
            applyFocusFromToolResolve(null, {
                tool: 'query_events',
                ok: true,
                args: { limit: 1 },
                result: {
                    events: [{ id: 1, relatedSessionId: SESSION_A, eventType: 'failed' }]
                }
            })?.sessionId
        ).toBe(SESSION_A)
    })

    it('promotes singleton query_open_loops to focus', () => {
        expect(
            applyFocusFromToolResolve(null, {
                tool: 'query_open_loops',
                ok: true,
                args: {},
                result: {
                    openLoops: [{ sessionId: SESSION_A, name: 'abandoned', bucket: 'waiting_on_you' }]
                }
            })?.sessionId
        ).toBe(SESSION_A)
        expect(
            applyFocusFromToolResolve(focus(), {
                tool: 'query_open_loops',
                ok: true,
                args: {},
                result: {
                    openLoops: [
                        { sessionId: SESSION_A, name: 'a' },
                        { sessionId: SESSION_B, name: 'b' }
                    ]
                }
            })
        ).toEqual(focus())
    })

    it('promotes singleton list-mode query_dispositions to focus', () => {
        expect(
            applyFocusFromToolResolve(null, {
                tool: 'query_dispositions',
                ok: true,
                args: {},
                result: {
                    mode: 'list',
                    rows: [{ itemId: 42, action: 'dismiss' }],
                    total: 1
                }
            })?.itemId
        ).toBe(42)
        expect(
            applyFocusFromToolResolve(focus(), {
                tool: 'query_dispositions',
                ok: true,
                args: { groupBy: ['action'] },
                result: {
                    mode: 'cluster',
                    clusters: [{ keys: { action: 'dismiss' }, count: 3 }],
                    total: 1
                }
            })
        ).toEqual(focus())
    })

    it('parses clear-tombstones and ignores them as write subjects', () => {
        const tomb = parseConverseFocus({
            sessionId: null,
            itemId: null,
            source: 'client',
            updatedAt: 50
        })
        expect(tomb).toEqual({
            sessionId: null,
            itemId: null,
            source: 'client',
            updatedAt: 50
        })
        expect(hasConverseFocusSubject(tomb)).toBe(false)
        expect(formatConverseFocusDirective(tomb)).toBeNull()
        expect(parseConverseFocus({ sessionId: null, itemId: null, source: 'client' })).toBeNull()
    })
})
