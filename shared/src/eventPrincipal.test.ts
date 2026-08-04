import { describe, expect, it } from 'bun:test'
import {
    assertPrincipalHasHumanOwner,
    defaultPrincipalForSourceKind,
    EventPrincipalOwnershipError,
    isValidGrantingEventId,
    parseEventPrincipal,
    serializeEventPrincipal
} from './eventPrincipal'

describe('eventPrincipal', () => {
    it('serializes wire snake_case; omits granting_event_id until grant shape exists', () => {
        const json = serializeEventPrincipal({
            kind: 'agent',
            id: 'overseer',
            onBehalfOf: 'operator',
            grantingEventId: 42
        })
        expect(JSON.parse(json)).toEqual({
            kind: 'agent',
            id: 'overseer',
            on_behalf_of: 'operator'
        })
        expect(json).not.toContain('granting_event_id')
    })

    it('parses historical granting_event_id leniently (read path; ownership not thrown)', () => {
        expect(
            parseEventPrincipal(
                JSON.stringify({
                    kind: 'agent',
                    id: 'overseer',
                    on_behalf_of: 'operator',
                    granting_event_id: 42
                })
            )
        ).toEqual({
            kind: 'agent',
            id: 'overseer',
            onBehalfOf: 'operator',
            grantingEventId: 42
        })
    })

    it('rejects non-positive / non-integer granting ids on parse', () => {
        expect(isValidGrantingEventId(1.5)).toBe(false)
        expect(isValidGrantingEventId(-3)).toBe(false)
        expect(isValidGrantingEventId(0)).toBe(false)
        expect(isValidGrantingEventId(7)).toBe(true)
        expect(
            parseEventPrincipal(
                JSON.stringify({
                    kind: 'human',
                    id: 'operator',
                    granting_event_id: 1.5
                })
            )?.grantingEventId
        ).toBeNull()
    })

    it('refuses non-human without human owner', () => {
        expect(() => assertPrincipalHasHumanOwner({ kind: 'agent', id: 'bot' })).toThrow(
            EventPrincipalOwnershipError
        )
        expect(() => serializeEventPrincipal({ kind: 'service', id: 'ci' })).toThrow(
            EventPrincipalOwnershipError
        )
        expect(() =>
            assertPrincipalHasHumanOwner({ kind: 'human', id: 'operator' })
        ).not.toThrow()
    })

    it('defaults every sourceKind to a resolvable human owner', () => {
        for (const kind of ['operator', 'overseer', 'worker', 'system', 'channel'] as const) {
            const p = defaultPrincipalForSourceKind(kind, 'ref-1')
            expect(() => assertPrincipalHasHumanOwner(p)).not.toThrow()
        }
    })
})
