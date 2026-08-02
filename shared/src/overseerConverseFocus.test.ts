import { describe, expect, it } from 'vitest'
import {
    applyFocusFromOperatorText,
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

describe('hub-owned conversational focus (capability, not pronoun grep)', () => {
    it('authorizes anaphoric relay against established focus without ids in the follow-up line', () => {
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

    it('updates focus when the operator clearly names a new subject', () => {
        const next = applyFocusFromOperatorText(focus({ itemId: 10, sessionId: SESSION_B }), 'look at item #118')
        expect(next?.itemId).toBe(118)
        expect(next?.sessionId).toBeNull()
        expect(next?.source).toBe('operator')
    })

    it('replaces focus when the operator names a different session', () => {
        const next = applyFocusFromOperatorText(
            focus(),
            `switch to session ${SESSION_B}`
        )
        expect(next?.sessionId).toBe(SESSION_B)
        expect(next?.itemId).toBeNull()
        expect(next?.source).toBe('operator')
    })

    it('updates focus from a successful subject-resolving tool, not from multi-item dumps', () => {
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

        const afterDump = applyFocusFromToolResolve(focus(), {
            tool: 'query_inbox',
            ok: true,
            args: { limit: 25 },
            result: {
                items: [
                    { id: 1, relatedSessionId: SESSION_B, title: 'noise' },
                    { id: 118, relatedSessionId: SESSION_A, title: 'W1.8' }
                ]
            }
        })
        // Multi-item list must not silently retarget away from established focus.
        expect(afterDump).toEqual(focus())
    })

    it('does not retarget focus from tool-result content alone (injection surface)', () => {
        // Focus updates only from structured hub tool resolves / operator naming —
        // never from re-parsing the projected tool-result prose fed to the brain.
        // A multi-row dump that *mentions* another session must leave focus alone.
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

    it('formats a focus directive for the brain assemble path', () => {
        const line = formatConverseFocusDirective(focus())
        expect(line).toContain('118')
        expect(line).toContain(SESSION_A)
        expect(line.toLowerCase()).toMatch(/focus|subject/)
    })
})
