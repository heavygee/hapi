/**
 * Structured event principal (RFC Security / A2A #1332).
 *
 * Wire JSON uses snake_case (`on_behalf_of`, `granting_event_id`).
 * TS uses camelCase. A non-human principal without a resolvable human owner
 * is a hard refuse — day-one kill criterion, independent of multi-user claims.
 */

export type EventPrincipalKind = 'human' | 'agent' | 'service'

export type EventPrincipal = {
    kind: EventPrincipalKind
    id: string
    /** Accountable human owner when kind is not `human`. */
    onBehalfOf?: string | null
    /** Optional pointer at the grant event for delegated_authority. */
    grantingEventId?: number | null
}

export class EventPrincipalOwnershipError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'EventPrincipalOwnershipError'
    }
}

/** Refuse a non-human principal with no resolvable human owner. */
export function assertPrincipalHasHumanOwner(principal: EventPrincipal): void {
    const id = principal.id?.trim() ?? ''
    if (!id) {
        throw new EventPrincipalOwnershipError('principal requires a non-empty id')
    }
    if (principal.kind === 'human') return
    const owner = principal.onBehalfOf?.trim() ?? ''
    if (!owner) {
        throw new EventPrincipalOwnershipError(
            `non-human principal ${principal.kind}:${id} has no resolvable human owner`
        )
    }
}

/** Serialize for `events.principal_json` (RFC wire shape). */
export function serializeEventPrincipal(principal: EventPrincipal): string {
    assertPrincipalHasHumanOwner(principal)
    const wire: Record<string, unknown> = {
        kind: principal.kind,
        id: principal.id.trim()
    }
    const owner = principal.onBehalfOf?.trim()
    if (owner) wire.on_behalf_of = owner
    if (principal.grantingEventId != null && Number.isFinite(principal.grantingEventId)) {
        wire.granting_event_id = principal.grantingEventId
    }
    return JSON.stringify(wire)
}

/** Parse stored JSON; returns null on missing/invalid. Does not throw on ownership. */
export function parseEventPrincipal(json: string | null | undefined): EventPrincipal | null {
    if (!json || !json.trim()) return null
    try {
        const raw = JSON.parse(json) as Record<string, unknown>
        const kind = raw.kind
        if (kind !== 'human' && kind !== 'agent' && kind !== 'service') return null
        if (typeof raw.id !== 'string' || !raw.id.trim()) return null
        const onBehalfOf =
            typeof raw.on_behalf_of === 'string'
                ? raw.on_behalf_of
                : typeof raw.onBehalfOf === 'string'
                    ? raw.onBehalfOf
                    : null
        const grantingRaw = raw.granting_event_id ?? raw.grantingEventId
        const grantingEventId =
            typeof grantingRaw === 'number' && Number.isFinite(grantingRaw) ? grantingRaw : null
        return {
            kind,
            id: raw.id.trim(),
            onBehalfOf,
            grantingEventId
        }
    } catch {
        return null
    }
}

/**
 * Single-operator fork defaults: every automated write still terminates at a
 * human owner (`operator`). Callers may override with an explicit principal.
 */
export function defaultPrincipalForSourceKind(
    sourceKind: string,
    sourceRef?: string | null
): EventPrincipal {
    const ref = sourceRef?.trim() || null
    switch (sourceKind) {
        case 'operator':
            return { kind: 'human', id: ref ?? 'operator' }
        case 'overseer':
            return { kind: 'agent', id: ref ?? 'overseer', onBehalfOf: 'operator' }
        case 'worker':
            return { kind: 'agent', id: ref ?? 'worker', onBehalfOf: 'operator' }
        case 'channel':
            return { kind: 'service', id: ref ?? 'channel', onBehalfOf: 'operator' }
        case 'system':
        default:
            return { kind: 'service', id: ref ?? 'hub', onBehalfOf: 'operator' }
    }
}
