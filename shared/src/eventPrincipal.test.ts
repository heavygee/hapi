import { describe, expect, it } from 'bun:test'
import {
    assertPrincipalHasHumanOwner,
    defaultPrincipalForSourceKind,
    EventPrincipalOwnershipError,
    parseEventPrincipal,
    serializeEventPrincipal
} from './eventPrincipal'

describe('eventPrincipal', () => {
    it('serializes wire snake_case and round-trips', () => {
        const json = serializeEventPrincipal({
            kind: 'agent',
            id: 'overseer',
            onBehalfOf: 'operator',
            grantingEventId: 42
        })
        expect(JSON.parse(json)).toEqual({
            kind: 'agent',
            id: 'overseer',
            on_behalf_of: 'operator',
            granting_event_id: 42
        })
        expect(parseEventPrincipal(json)).toEqual({
            kind: 'agent',
            id: 'overseer',
            onBehalfOf: 'operator',
            grantingEventId: 42
        })
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
