/**
 * Hub-owned conversational focus for Overseer converse.
 *
 * Structured dialogue-state (session and/or inbox item) that brain + write gate
 * share. Focus updates from successful hub-executed tool resolutions that
 * identify a subject — not from grepping pronouns or ids out of operator prose.
 * Tool-result *prose* fed back to the brain is untrusted and must not retarget
 * focus by itself.
 */

export type OverseerConverseFocusSource = 'tool_resolve' | 'client'

export type OverseerConverseFocus = {
    sessionId: string | null
    itemId: number | null
    source: OverseerConverseFocusSource
    updatedAt: number
}

export type OverseerToolResolveEvent = {
    tool: string
    ok: boolean
    args: Record<string, unknown>
    result: unknown
}

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildFocus(input: {
    sessionId?: string | null
    itemId?: number | null
    source: OverseerConverseFocusSource
    previous?: OverseerConverseFocus | null
    now?: number
}): OverseerConverseFocus | null {
    const prev = input.previous ?? null

    let nextSession: string | null
    if (input.sessionId === null) {
        nextSession = null
    } else if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
        nextSession = input.sessionId.trim()
    } else {
        nextSession = prev?.sessionId ?? null
    }

    let nextItem: number | null
    if (input.itemId === null) {
        nextItem = null
    } else if (typeof input.itemId === 'number' && Number.isFinite(input.itemId) && input.itemId > 0) {
        nextItem = input.itemId
    } else {
        nextItem = prev?.itemId ?? null
    }

    if (!nextSession && nextItem == null) return null

    const unchanged =
        prev != null &&
        prev.sessionId === nextSession &&
        prev.itemId === nextItem

    return {
        sessionId: nextSession,
        itemId: nextItem,
        source: unchanged ? prev.source : input.source,
        updatedAt: unchanged ? prev.updatedAt : (input.now ?? Date.now())
    }
}

/** Seed focus from an explicit client-related session (transport thread), not NL grep. */
export function applyFocusFromClientSession(
    previous: OverseerConverseFocus | null,
    sessionId: string | null | undefined,
    now = Date.now()
): OverseerConverseFocus | null {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) return previous
    return buildFocus({
        previous,
        sessionId: id,
        source: 'client',
        now
    })
}

function sessionFromResult(result: unknown): string | null {
    if (!isObj(result)) return null
    if (typeof result.sessionId === 'string' && result.sessionId.trim()) {
        return result.sessionId.trim()
    }
    if (isObj(result.state) && typeof result.state.id === 'string' && result.state.id.trim()) {
        return result.state.id.trim()
    }
    if (isObj(result.health) && typeof result.health.id === 'string' && result.health.id.trim()) {
        return result.health.id.trim()
    }
    if (
        isObj(result.explanation) &&
        typeof result.explanation.relatedSessionId === 'string' &&
        result.explanation.relatedSessionId.trim()
    ) {
        return result.explanation.relatedSessionId.trim()
    }
    return null
}

function itemFromResult(result: unknown): number | null {
    if (!isObj(result)) return null
    if (typeof result.itemId === 'number' && result.itemId > 0) return result.itemId
    if (
        isObj(result.explanation) &&
        typeof result.explanation.inboxItemId === 'number' &&
        result.explanation.inboxItemId > 0
    ) {
        return result.explanation.inboxItemId
    }
    return null
}

/**
 * Update focus after a hub-executed tool call with structured args/result.
 * Multi-item list tools never retarget (avoids wander from inbox dumps).
 * Does not parse tool-result prose — only structured fields from the hub call.
 */
export function applyFocusFromToolResolve(
    previous: OverseerConverseFocus | null,
    event: OverseerToolResolveEvent,
    now = Date.now()
): OverseerConverseFocus | null {
    if (!event.ok) return previous

    const tool = event.tool
    const args = event.args
    const result = event.result

    if (tool === 'explain_priority') {
        const itemId =
            itemFromResult(result) ??
            (typeof args.itemId === 'number' ? args.itemId : null)
        const sessionId = sessionFromResult(result)
        if (itemId == null && !sessionId) return previous
        // New item resolve replaces the prior pair (subject change).
        return {
            sessionId: sessionId,
            itemId: itemId,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    if (
        tool === 'get_session_state' ||
        tool === 'get_session_recent_output' ||
        tool === 'get_worker_health'
    ) {
        const fromArgs = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
        const sessionId = sessionFromResult(result) ?? (fromArgs || null)
        if (!sessionId) return previous
        // Session probe replaces session; clear item unless same session keeps prior item.
        const keepItem =
            previous?.sessionId &&
            previous.sessionId.toLowerCase() === sessionId.toLowerCase()
                ? previous.itemId
                : null
        return {
            sessionId,
            itemId: keepItem,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    if (tool === 'ping_session') {
        const sessionId =
            sessionFromResult(result) ??
            (typeof args.sessionId === 'string' ? args.sessionId.trim() : null)
        const itemId =
            itemFromResult(result) ??
            (typeof args.itemId === 'number' ? args.itemId : null)
        if (!sessionId && itemId == null) return previous
        return buildFocus({
            previous,
            sessionId: sessionId || undefined,
            itemId: itemId ?? undefined,
            source: 'tool_resolve',
            now
        })
    }

    if (tool === 'record_disposition') {
        const itemId = typeof args.itemId === 'number' ? args.itemId : itemFromResult(result)
        if (itemId == null) return previous
        return buildFocus({
            previous,
            itemId,
            source: 'tool_resolve',
            now
        })
    }

    // query_inbox: only retarget when exactly one subject.
    if (tool === 'query_inbox' && isObj(result) && Array.isArray(result.items)) {
        if (result.items.length !== 1) return previous
        const only = result.items[0]
        if (!isObj(only)) return previous
        const itemId = typeof only.id === 'number' ? only.id : null
        const sessionId =
            typeof only.relatedSessionId === 'string'
                ? only.relatedSessionId
                : typeof only.session === 'string'
                    ? only.session
                    : null
        if (itemId == null && !sessionId) return previous
        return {
            sessionId,
            itemId,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    return previous
}

/** System-prompt / assemble hint so the brain shares the hub referent. */
export function formatConverseFocusDirective(focus: OverseerConverseFocus | null): string | null {
    if (!focus || (!focus.sessionId && focus.itemId == null)) return null
    const parts: string[] = ['# Conversational focus (hub-owned)', '']
    parts.push(
        'The operator is currently focused on the subject below. Prefer this referent for',
        'queries and writes unless they clearly direct you to a different session or inbox item',
        '(via a tool resolve). Do not invent a different session id.',
        'When they direct action on this subject in natural language, use write tools against it.'
    )
    parts.push('')
    if (focus.itemId != null) parts.push(`- inbox itemId: ${focus.itemId}`)
    if (focus.sessionId) parts.push(`- sessionId: ${focus.sessionId}`)
    parts.push(`- established via: ${focus.source}`)
    return parts.join('\n')
}

export function parseConverseFocus(raw: unknown): OverseerConverseFocus | null {
    if (!isObj(raw)) return null
    const sessionId =
        typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId.trim() : null
    const itemId =
        typeof raw.itemId === 'number' && Number.isFinite(raw.itemId) && raw.itemId > 0
            ? raw.itemId
            : null
    if (!sessionId && itemId == null) return null
    const source: OverseerConverseFocusSource =
        raw.source === 'tool_resolve' || raw.source === 'client' ? raw.source : 'tool_resolve'
    const updatedAt =
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : Date.now()
    return { sessionId, itemId, source, updatedAt }
}
