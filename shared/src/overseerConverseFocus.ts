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

/** True when focus names a session and/or inbox item (not a clear-tombstone). */
export function hasConverseFocusSubject(
    focus: OverseerConverseFocus | null | undefined
): boolean {
    if (!focus) return false
    return Boolean(focus.sessionId?.trim()) || (focus.itemId != null && focus.itemId > 0)
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
    if (previous?.sessionId && previous.sessionId.toLowerCase() === id.toLowerCase()) {
        return previous
    }
    // Client thread wins over durable focus — clear item (may belong to the old session).
    return {
        sessionId: id,
        itemId: null,
        source: 'client',
        updatedAt: now
    }
}

function sessionFromResult(result: unknown): string | null {
    if (!isObj(result)) return null
    if (typeof result.sessionId === 'string' && result.sessionId.trim()) {
        return result.sessionId.trim()
    }
    if (isObj(result.state)) {
        if (typeof result.state.sessionId === 'string' && result.state.sessionId.trim()) {
            return result.state.sessionId.trim()
        }
        if (typeof result.state.id === 'string' && result.state.id.trim()) {
            return result.state.id.trim()
        }
    }
    if (isObj(result.health)) {
        if (typeof result.health.sessionId === 'string' && result.health.sessionId.trim()) {
            return result.health.sessionId.trim()
        }
        if (typeof result.health.id === 'string' && result.health.id.trim()) {
            return result.health.id.trim()
        }
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
        if (!isObj(result) || result.explanation == null) return previous
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

    if (tool === 'get_session_state') {
        if (!isObj(result) || result.state == null) return previous
        const sessionId = sessionFromResult(result)
        if (!sessionId) return previous
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

    if (tool === 'get_worker_health') {
        if (!isObj(result) || result.health == null) return previous
        const sessionId = sessionFromResult(result)
        if (!sessionId) return previous
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

    // recent_output has no resolved session identity in the result — do not
    // promote a model-supplied arg into durable focus.
    if (tool === 'get_session_recent_output') {
        return previous
    }

    if (tool === 'ping_session') {
        const sessionId =
            sessionFromResult(result) ??
            (typeof args.sessionId === 'string' ? args.sessionId.trim() : null)
        const itemId =
            itemFromResult(result) ??
            (typeof args.itemId === 'number' ? args.itemId : null)
        if (!sessionId && itemId == null) return previous
        // Subject-changing write replaces the whole pair — do not inherit a
        // stale counterpart from the prior focus (Codex P2).
        return {
            sessionId: sessionId || null,
            itemId: itemId ?? null,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    if (tool === 'record_disposition') {
        const itemId = typeof args.itemId === 'number' ? args.itemId : itemFromResult(result)
        if (itemId == null) return previous
        const sessionId =
            sessionFromResult(result) ??
            (typeof args.sessionId === 'string' ? args.sessionId.trim() : null)
        return {
            sessionId: sessionId || null,
            itemId,
            source: 'tool_resolve',
            updatedAt: now
        }
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

    // Singleton worker roster — same singular-subject rule as query_inbox.
    if (tool === 'list_active_workers' && isObj(result) && Array.isArray(result.workers)) {
        if (result.workers.length !== 1) return previous
        const only = result.workers[0]
        if (!isObj(only)) return previous
        const sessionId =
            typeof only.sessionId === 'string'
                ? only.sessionId.trim()
                : typeof only.id === 'string'
                    ? only.id.trim()
                    : ''
        if (!sessionId) return previous
        return {
            sessionId,
            itemId: null,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    // Singleton open-loop — same rule (abandoned-thread questions).
    if (tool === 'query_open_loops' && isObj(result) && Array.isArray(result.openLoops)) {
        if (result.openLoops.length !== 1) return previous
        const only = result.openLoops[0]
        if (!isObj(only)) return previous
        const sessionId =
            typeof only.sessionId === 'string'
                ? only.sessionId.trim()
                : typeof only.id === 'string'
                    ? only.id.trim()
                    : ''
        if (!sessionId) return previous
        return {
            sessionId,
            itemId: null,
            source: 'tool_resolve',
            updatedAt: now
        }
    }

    return previous
}

/** System-prompt / assemble hint so the brain shares the hub referent. */
export function formatConverseFocusDirective(focus: OverseerConverseFocus | null): string | null {
    if (!hasConverseFocusSubject(focus)) return null
    const parts: string[] = ['# Conversational focus (hub-owned)', '']
    parts.push(
        'The operator is currently focused on the subject below. Prefer this referent for',
        'queries and writes unless they clearly direct you to a different session or inbox item',
        '(via a tool resolve). Do not invent a different session id.',
        'When they direct action on this subject in natural language, use write tools against it.'
    )
    parts.push('')
    if (focus!.itemId != null) parts.push(`- inbox itemId: ${focus!.itemId}`)
    if (focus!.sessionId) parts.push(`- sessionId: ${focus!.sessionId}`)
    parts.push(`- established via: ${focus!.source}`)
    return parts.join('\n')
}

/**
 * Parse persisted focus. Empty session+item with an updatedAt is a clear-tombstone
 * (generation barrier for concurrent older turns) — not a live subject.
 */
export function parseConverseFocus(raw: unknown): OverseerConverseFocus | null {
    if (!isObj(raw)) return null
    const sessionId =
        typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId.trim() : null
    const itemId =
        typeof raw.itemId === 'number' && Number.isFinite(raw.itemId) && raw.itemId > 0
            ? raw.itemId
            : null
    const source: OverseerConverseFocusSource =
        raw.source === 'tool_resolve' || raw.source === 'client' ? raw.source : 'tool_resolve'
    const updatedAt =
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : Date.now()
    if (!sessionId && itemId == null) {
        // Tombstone must carry an updatedAt so setConverseFocusIfNewer can reject
        // older in-flight turns that still hold the deleted session.
        if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null
        return { sessionId: null, itemId: null, source, updatedAt }
    }
    return { sessionId, itemId, source, updatedAt }
}
