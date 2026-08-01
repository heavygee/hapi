/**
 * Hub-owned Overseer converse context.
 *
 * Transports (text / voice / XR) send the latest operator utterance; the hub
 * hydrates prior `convo_turn` events into `messages` before `runOverseerConverse`.
 * No transport-local chat DB. Disposition tombstones stay available via the
 * existing `query_dispositions` tool (tombstone-as-summarizer) — this module
 * does not invent a second summarize engine.
 */

import {
    OVERSEER_CONVO_TURN_EVENT_TYPE,
    type OverseerConverseMessage,
    type OverseerToolName
} from '@hapi/protocol'
import type { OverseerEntity } from '../sync/overseerEntity'
import type { StoredSystemEvent } from '../store'

/** Max prior operator↔overseer pairs to load from the events table. */
export const DEFAULT_CONVERSE_HISTORY_MAX_TURNS = 16

/**
 * Soft char budget for hydrated history (excludes the latest operator line).
 * Keeps the brain window from filling with old tool-trace prose; drop oldest first.
 */
export const DEFAULT_CONVERSE_HISTORY_MAX_CHARS = 24_000

export type StoredConvoTurnView = {
    id: number
    ts: number
    operatorText: string
    overseerText: string
    relatedSessionId: string | null
    toolCalls: Array<{ tool: OverseerToolName; argsSummary?: string }>
}

export type AssembleConverseContextResult = {
    /** Oldest-first messages for the brain, ending with the latest operator line. */
    messages: OverseerConverseMessage[]
    /** How many prior convo_turn rows contributed (after budget trim). */
    hydratedTurns: number
    /** True when older turns were dropped to stay under maxChars / maxTurns. */
    truncated: boolean
}

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseConvoTurnPayload(payloadJson: string | null): {
    operatorText: string
    overseerText: string
    toolCalls: Array<{ tool: OverseerToolName; argsSummary?: string }>
} {
    if (!payloadJson) {
        return { operatorText: '', overseerText: '', toolCalls: [] }
    }
    try {
        const parsed: unknown = JSON.parse(payloadJson)
        if (!isObj(parsed)) {
            return { operatorText: '', overseerText: '', toolCalls: [] }
        }
        const operatorText = typeof parsed.operatorText === 'string' ? parsed.operatorText : ''
        const overseerText = typeof parsed.overseerText === 'string' ? parsed.overseerText : ''
        const rawCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : []
        const toolCalls: Array<{ tool: OverseerToolName; argsSummary?: string }> = []
        for (const call of rawCalls) {
            if (!isObj(call) || typeof call.tool !== 'string') continue
            toolCalls.push({
                tool: call.tool as OverseerToolName,
                argsSummary: typeof call.argsSummary === 'string' ? call.argsSummary : undefined
            })
        }
        return { operatorText, overseerText, toolCalls }
    } catch {
        return { operatorText: '', overseerText: '', toolCalls: [] }
    }
}

export function eventToConvoTurnView(event: StoredSystemEvent): StoredConvoTurnView | null {
    if (event.eventType !== OVERSEER_CONVO_TURN_EVENT_TYPE) return null
    const payload = parseConvoTurnPayload(event.payloadJson)
    if (!payload.operatorText.trim() && !payload.overseerText.trim()) return null
    return {
        id: event.id,
        ts: event.ts,
        operatorText: payload.operatorText,
        overseerText: payload.overseerText,
        relatedSessionId: event.relatedSessionId,
        toolCalls: payload.toolCalls
    }
}

/** Newest-first from the store; returned oldest-first for display / assemble. */
export function listRecentConvoTurns(
    overseer: OverseerEntity,
    opts: { limit?: number } = {}
): StoredConvoTurnView[] {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_CONVERSE_HISTORY_MAX_TURNS, 1), 50)
    const events = overseer.queryEvents({
        eventType: OVERSEER_CONVO_TURN_EVENT_TYPE,
        limit
    })
    const views: StoredConvoTurnView[] = []
    for (const event of events) {
        const view = eventToConvoTurnView(event)
        if (view) views.push(view)
    }
    // events.query is id DESC — reverse to chronological.
    return views.reverse()
}

function turnsToMessages(turns: StoredConvoTurnView[]): OverseerConverseMessage[] {
    const messages: OverseerConverseMessage[] = []
    for (const turn of turns) {
        const op = turn.operatorText.trim()
        const ov = turn.overseerText.trim()
        if (op) messages.push({ role: 'operator', content: op })
        if (ov) messages.push({ role: 'overseer', content: ov })
    }
    return messages
}

function messagesCharCount(messages: OverseerConverseMessage[]): number {
    return messages.reduce((sum, m) => sum + m.content.length, 0)
}

/**
 * Apply turn + char budgets by dropping the oldest turns first.
 * Returns the kept turns (oldest-first) and whether anything was dropped.
 */
export function budgetConvoTurns(
    turnsOldestFirst: StoredConvoTurnView[],
    opts: { maxTurns?: number; maxChars?: number } = {}
): { turns: StoredConvoTurnView[]; truncated: boolean } {
    const maxTurns = opts.maxTurns ?? DEFAULT_CONVERSE_HISTORY_MAX_TURNS
    const maxChars = opts.maxChars ?? DEFAULT_CONVERSE_HISTORY_MAX_CHARS

    let kept = turnsOldestFirst
    let truncated = false
    if (kept.length > maxTurns) {
        kept = kept.slice(kept.length - maxTurns)
        truncated = true
    }

    while (kept.length > 0 && messagesCharCount(turnsToMessages(kept)) > maxChars) {
        kept = kept.slice(1)
        truncated = true
    }
    return { turns: kept, truncated }
}

/**
 * Hub-owned assemble: prior `convo_turn`s (budgeted) + the client's latest operator line.
 * Ignores any prior client history so transports cannot fork memory.
 */
export function assembleOverseerConverseMessages(params: {
    overseer: OverseerEntity
    clientMessages: OverseerConverseMessage[]
    maxTurns?: number
    maxChars?: number
}): AssembleConverseContextResult {
    const { overseer, clientMessages, maxTurns, maxChars } = params
    if (clientMessages.length === 0) {
        throw new Error('clientMessages must include the latest operator utterance')
    }
    const latest = clientMessages[clientMessages.length - 1]!
    if (latest.role !== 'operator') {
        throw new Error('Last client message must be from the operator')
    }

    const fetched = listRecentConvoTurns(overseer, {
        limit: Math.max(maxTurns ?? DEFAULT_CONVERSE_HISTORY_MAX_TURNS, 1)
    })
    const { turns, truncated } = budgetConvoTurns(fetched, { maxTurns, maxChars })
    const history = turnsToMessages(turns)

    // If the operator re-sent the exact last logged question without a reply yet
    // (unlikely — we only record after reply), avoid duplicating. Normal path:
    // current utterance is not in the store until after this turn completes.
    const lastHistory = history[history.length - 1]
    if (
        lastHistory?.role === 'operator'
        && lastHistory.content === latest.content
        && (history.length < 2 || history[history.length - 2]?.role !== 'overseer')
    ) {
        return { messages: history, hydratedTurns: turns.length, truncated }
    }

    return {
        messages: [...history, latest],
        hydratedTurns: turns.length,
        truncated
    }
}
