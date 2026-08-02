/**
 * Hub-owned conversational focus for Overseer converse.
 *
 * Structured dialogue-state (session and/or inbox item) that brain + write gate
 * share. Not pronoun/regex grepping — focus updates from clear operator naming
 * and successful hub-executed tool resolutions. Tool-result *prose* fed back to
 * the brain is untrusted and must not retarget focus by itself.
 */

export type OverseerConverseFocusSource = 'operator' | 'tool_resolve' | 'client'

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

const ITEM_ID_RE = /\b(?:item\s*#?|#)(\d+)\b/gi
const UUID_OR_HEX_SESSION_RE =
    /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{8,})\b/gi
const NAMED_SESSION_RE = /\bsession\s+([a-z0-9][a-z0-9_-]{1,63})\b/gi

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractItemIds(text: string): number[] {
    const out: number[] = []
    for (const match of text.matchAll(ITEM_ID_RE)) {
        const id = Number(match[1])
        if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id)
    }
    return out
}

function extractSessionIdPrefixes(text: string): string[] {
    const out: string[] = []
    for (const match of text.matchAll(UUID_OR_HEX_SESSION_RE)) {
        const value = match[1]?.toLowerCase()
        if (value && !out.includes(value)) out.push(value)
    }
    for (const match of text.matchAll(NAMED_SESSION_RE)) {
        const value = match[1]?.toLowerCase()
        if (value && !out.includes(value)) out.push(value)
    }
    return out
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

/**
 * Establish / replace focus from clear operator naming in the latest utterance.
 * Does not invent subjects from pronouns — ids / `item #N` / `session <token>` only.
 * Returns previous focus unchanged when the line names nothing.
 *
 * Naming only an item clears a prior session (and vice versa) so we do not keep
 * a stale pair across subjects; successful tool resolves fill the other slot.
 */
export function applyFocusFromOperatorText(
    previous: OverseerConverseFocus | null,
    operatorText: string,
    now = Date.now()
): OverseerConverseFocus | null {
    const text = operatorText.trim()
    if (!text) return previous

    const itemIds = extractItemIds(text)
    const sessions = extractSessionIdPrefixes(text)
    if (itemIds.length === 0 && sessions.length === 0) return previous

    const itemId = itemIds.length > 0 ? itemIds[itemIds.length - 1]! : null
    const sessionId = sessions.length > 0 ? sessions[sessions.length - 1]! : null

    return {
        sessionId,
        itemId,
        source: 'operator',
        updatedAt: now
    }
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
        return buildFocus({
            previous,
            itemId: itemId ?? undefined,
            sessionId: sessionId ?? undefined,
            source: 'tool_resolve',
            now
        })
    }

    if (
        tool === 'get_session_state' ||
        tool === 'get_session_recent_output' ||
        tool === 'get_worker_health'
    ) {
        const fromArgs = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
        const sessionId = sessionFromResult(result) ?? (fromArgs || null)
        if (!sessionId) return previous
        return buildFocus({
            previous,
            sessionId,
            // Session-only probe: keep prior item if any (same worker thread).
            source: 'tool_resolve',
            now
        })
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

    // query_inbox / query_events / list dumps: only retarget when exactly one subject.
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
        return buildFocus({
            previous,
            itemId: itemId ?? undefined,
            sessionId: sessionId ?? undefined,
            source: 'tool_resolve',
            now
        })
    }

    return previous
}

/** System-prompt / assemble hint so the brain shares the hub referent. */
export function formatConverseFocusDirective(focus: OverseerConverseFocus | null): string | null {
    if (!focus || (!focus.sessionId && focus.itemId == null)) return null
    const parts: string[] = ['# Conversational focus (hub-owned)', '']
    parts.push(
        'The operator is currently focused on the subject below. Prefer this referent for',
        'queries and writes unless they clearly name a different session or inbox item.',
        'Do not invent a different session id.'
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
        raw.source === 'operator' || raw.source === 'tool_resolve' || raw.source === 'client'
            ? raw.source
            : 'tool_resolve'
    const updatedAt =
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : Date.now()
    return { sessionId, itemId, source, updatedAt }
}
