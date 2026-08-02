import { describe, expect, it } from 'vitest'
import {
    applyFocusFromClientSession,
    applyFocusFromToolResolve,
    formatConverseFocusDirective,
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
    })

    it('formats a focus directive for the brain assemble path', () => {
        const line = formatConverseFocusDirective(focus())
        expect(line).toContain('118')
        expect(line).toContain(SESSION_A)
        expect(line.toLowerCase()).toMatch(/focus|subject/)
    })
})
