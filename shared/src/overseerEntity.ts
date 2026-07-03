/**
 * Overseer entity — Step 3 (read-only / Stage 0).
 *
 * The Overseer is a continuous conversational entity over the fleet. Unlike a
 * worker session it has no agent process; its "session-equivalent" is the
 * events table (`convo_turn` / `decided` / `dispatched` records) plus the
 * read-only query tools defined here. This module owns the protocol-level
 * surface shared by hub + web + voice:
 *
 *  - stable identity constants
 *  - the read-only tool catalog (names, descriptions, zod arg schemas)
 *  - the voice/system prompt builder (chief-of-staff framing, Stage 0 = inform only)
 *  - worker-state derivation helpers (contracts §2: reported / observed / inferred)
 *  - the `convo_turn` event-input builder (memory-bearing, never an inbox item)
 *
 * Persona tuning (warmth/wit/pushback calibration) is deliberately thin here:
 * the build-sequence gates persona iteration on the Step 2.75 replay harness
 * ("vibes in a trench coat" otherwise). This module ships the *plumbing* prompt:
 * factual, provenance-first, contradiction-aware, read-only.
 */

import { z } from 'zod'
import type { InboxItemStatus } from './overseerInbox'

/** Stable id for the single fleet-level Overseer entity. */
export const OVERSEER_ENTITY_ID = 'overseer'

/** `source_kind` / `sink_kind` used for Overseer-authored events. */
export const OVERSEER_SOURCE_KIND = 'overseer' as const

/** Event type for an operator<->Overseer conversation segment (memory-bearing). */
export const OVERSEER_CONVO_TURN_EVENT_TYPE = 'convo_turn' as const

// ---------------------------------------------------------------------------
// Worker state model (contracts §2)
// ---------------------------------------------------------------------------

export const OVERSEER_WORKER_STATES = [
    'idle',
    'working',
    'waiting_on_operator',
    'waiting_on_external',
    'blocked',
    'failed',
    'complete',
    'stale',
    'unknown'
] as const

export type OverseerWorkerState = typeof OVERSEER_WORKER_STATES[number]

/** A worker-health view distinguishes three sources of truth (contracts §2). */
export type OverseerWorkerHealth = {
    sessionId: string
    name: string | null
    project: string | null
    flavor: string | null
    /** What the worker says — strongest but may lie or be silent. */
    reportedState: OverseerWorkerState
    /** Session activity the hub can directly observe — factual but coarse. */
    observedState: OverseerWorkerState
    /** Combination + heuristics — useful but explicitly uncertain. */
    inferredState: OverseerWorkerState
    /** 0..1 confidence in the inferred state; lower when sources disagree. */
    inferredConfidence: number
    /** Human-readable signal trail backing the inferred state ("show receipts"). */
    signals: string[]
    lastActivityAt: number | null
    silenceMs: number | null
    pendingRequestCount: number
}

export type OverseerSessionStateView = {
    sessionId: string
    name: string | null
    project: string | null
    flavor: string | null
    active: boolean
    thinking: boolean
    observedState: OverseerWorkerState
    workerReportedState: OverseerWorkerState | null
    lastActivityAt: number | null
    silenceMs: number | null
    /** Age of the most recent observed tool call, when known. */
    lastToolCallAgeMs: number | null
    pendingRequestCount: number
}

export type OverseerActiveWorker = {
    sessionId: string
    name: string | null
    project: string | null
    flavor: string | null
    observedState: OverseerWorkerState
    active: boolean
    lastActivityAt: number | null
    ageMs: number | null
}

export type OverseerRecentOutputChunk = {
    messageId: string
    role: 'operator' | 'worker' | 'unknown'
    text: string
    createdAt: number
}

export type OverseerExplainPriority = {
    inboxItemId: number
    title: string
    category: string
    status: InboxItemStatus | string
    priority: number
    basePriority: number
    agingFactor: number | null
    timeCriticality: number | null
    /** The provenance string stored at scoring time — recited, not recomputed. */
    reasonForPriority: string | null
    sourceEventIds: number[]
    relatedSessionId: string | null
    /** Lightweight detail for each contributing event (provenance trail). */
    sourceEvents: Array<{
        id: number
        eventType: string
        summary: string
        ts: number
        severity: number | null
        sourceKind: string
    }>
}

/**
 * Map a worker `AGENT_NOTIFY_SUMMARY` status to a worker state (contracts §2).
 * Used to derive `worker_reported_state` from the latest worker event.
 */
export function mapNotifyStatusToWorkerState(status: string | null | undefined): OverseerWorkerState {
    switch (status) {
        case 'done':
            return 'complete'
        case 'blocked':
            return 'blocked'
        case 'failed':
            return 'failed'
        case 'needs_decision':
        case 'needs_review':
            return 'waiting_on_operator'
        case 'stalled':
            return 'stale'
        default:
            return status ? 'working' : 'unknown'
    }
}

/** Map a stored `event_type` to the worker state it implies (reported view). */
export function mapEventTypeToWorkerState(eventType: string): OverseerWorkerState {
    switch (eventType) {
        case 'completed':
            return 'complete'
        case 'blocked':
            return 'blocked'
        case 'failed':
            return 'failed'
        case 'needs_decision':
        case 'needs_review':
        case 'approval_requested':
        case 'permission_request':
            return 'waiting_on_operator'
        case 'stale':
            return 'stale'
        case 'progress':
        case 'tool_call':
        case 'tool_result':
            return 'working'
        default:
            return 'unknown'
    }
}

export type ObservedStateInput = {
    active: boolean
    thinking: boolean
    /** ms since the last observed activity, or null if unknown. */
    silenceMs: number | null
    pendingRequestCount: number
    staleSilenceMs: number
}

/** Hub-observed state from raw session signals (factual but coarse). */
export function deriveObservedWorkerState(input: ObservedStateInput): OverseerWorkerState {
    if (input.pendingRequestCount > 0) {
        return 'waiting_on_operator'
    }
    if (input.thinking) {
        return 'working'
    }
    if (!input.active) {
        return 'idle'
    }
    if (input.silenceMs !== null && input.silenceMs >= input.staleSilenceMs) {
        return 'stale'
    }
    return 'idle'
}

export type InferStateInput = {
    reported: OverseerWorkerState | null
    observed: OverseerWorkerState
    silenceMs: number | null
    staleSilenceMs: number
}

export type InferredStateResult = {
    state: OverseerWorkerState
    confidence: number
    /** Note appended to the signal trail explaining the inference. */
    note: string
}

/**
 * Combine reported + observed into the inferred view, preserving uncertainty
 * (contracts §2, §14). Never papers over a reported/observed conflict — when
 * the worker claims `working` but the hub has seen long silence, the inferred
 * state degrades to `stale` with a low confidence and an explicit note.
 */
export function inferWorkerState(input: InferStateInput): InferredStateResult {
    const { reported, observed, silenceMs, staleSilenceMs } = input
    const longSilence = silenceMs !== null && silenceMs >= staleSilenceMs

    // Terminal / unambiguous reported states win — they are the strongest signal
    // and not contradicted by silence (a blocked worker is correctly quiet).
    if (reported === 'blocked' || reported === 'failed' || reported === 'complete') {
        return { state: reported, confidence: 0.9, note: `worker self-reported ${reported}` }
    }

    if (reported === 'working' && longSilence) {
        return {
            state: 'stale',
            confidence: 0.4,
            note: 'worker reports working but hub has seen no output past the silence threshold — possibly wedged'
        }
    }

    if (reported && reported !== 'unknown') {
        return { state: reported, confidence: 0.75, note: `worker self-reported ${reported}` }
    }

    // No usable report — fall back to the observed signal.
    return {
        state: observed,
        confidence: observed === 'unknown' ? 0.2 : 0.6,
        note: 'no worker self-report; using hub-observed state'
    }
}

// ---------------------------------------------------------------------------
// Read-only tool catalog
// ---------------------------------------------------------------------------

export const OVERSEER_TOOL_NAMES = [
    'query_events',
    'query_inbox',
    'get_session_state',
    'get_session_recent_output',
    'get_worker_health',
    'explain_priority',
    'list_active_workers'
] as const

export type OverseerToolName = typeof OVERSEER_TOOL_NAMES[number]

const sessionIdSchema = z.string().min(1)

export const queryEventsArgsSchema = z.object({
    sessionId: sessionIdSchema.optional(),
    project: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    sourceKind: z.enum(['worker', 'overseer', 'operator', 'system', 'channel']).optional(),
    attentionCandidate: z.union([z.literal(0), z.literal(1)]).optional(),
    severityMin: z.number().int().min(1).max(5).optional(),
    sinceTs: z.number().int().nonnegative().optional(),
    untilTs: z.number().int().nonnegative().optional(),
    beforeId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(200).optional()
})
export type QueryEventsArgs = z.infer<typeof queryEventsArgsSchema>

export const queryInboxArgsSchema = z.object({
    statuses: z.array(z.string().min(1)).min(1).optional(),
    sessionId: sessionIdSchema.optional(),
    category: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional()
})
export type QueryInboxArgs = z.infer<typeof queryInboxArgsSchema>

export const getSessionStateArgsSchema = z.object({
    sessionId: sessionIdSchema
})
export type GetSessionStateArgs = z.infer<typeof getSessionStateArgsSchema>

export const getSessionRecentOutputArgsSchema = z.object({
    sessionId: sessionIdSchema,
    n: z.number().int().min(1).max(50).optional()
})
export type GetSessionRecentOutputArgs = z.infer<typeof getSessionRecentOutputArgsSchema>

export const getWorkerHealthArgsSchema = z.object({
    sessionId: sessionIdSchema
})
export type GetWorkerHealthArgs = z.infer<typeof getWorkerHealthArgsSchema>

export const explainPriorityArgsSchema = z.object({
    itemId: z.number().int().positive()
})
export type ExplainPriorityArgs = z.infer<typeof explainPriorityArgsSchema>

export const listActiveWorkersArgsSchema = z.object({
    project: z.string().min(1).optional(),
    state: z.enum(OVERSEER_WORKER_STATES).optional(),
    minAgeMs: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(200).optional()
})
export type ListActiveWorkersArgs = z.infer<typeof listActiveWorkersArgsSchema>

export const overseerToolArgsSchemas = {
    query_events: queryEventsArgsSchema,
    query_inbox: queryInboxArgsSchema,
    get_session_state: getSessionStateArgsSchema,
    get_session_recent_output: getSessionRecentOutputArgsSchema,
    get_worker_health: getWorkerHealthArgsSchema,
    explain_priority: explainPriorityArgsSchema,
    list_active_workers: listActiveWorkersArgsSchema
} as const satisfies Record<OverseerToolName, z.ZodTypeAny>

export type OverseerToolCatalogEntry = {
    name: OverseerToolName
    description: string
    readonly: true
}

/** Catalog surfaced to the voice/system layer; all entries are read-only. */
export const OVERSEER_TOOL_CATALOG: OverseerToolCatalogEntry[] = [
    {
        name: 'query_events',
        description: 'Read the fleet events stream, filtered by session, project, type, source, severity, time window, or attention-candidate flag.',
        readonly: true
    },
    {
        name: 'query_inbox',
        description: 'Read current inbox items — candidates, surfaced items, and held intent items — optionally filtered by status, session, or category.',
        readonly: true
    },
    {
        name: 'get_session_state',
        description: 'Hub-observed state for one session: activity, tool-call recency, pending requests, and the worker-reported state when available.',
        readonly: true
    },
    {
        name: 'get_session_recent_output',
        description: 'Last N transcript chunks for one session, for context.',
        readonly: true
    },
    {
        name: 'get_worker_health',
        description: 'Combined worker health: reported + observed + inferred state with a signal trail (never collapses a reported/observed conflict).',
        readonly: true
    },
    {
        name: 'explain_priority',
        description: 'Provenance trail for one inbox item: why it sits where it does, reciting the stored reason and contributing event IDs.',
        readonly: true
    },
    {
        name: 'list_active_workers',
        description: 'Summary roster of workers, filterable by project, state, and minimum age.',
        readonly: true
    }
]

export type OverseerIdentity = {
    id: string
    kind: typeof OVERSEER_SOURCE_KIND
    /** Stage 0: read-only. The Overseer can inform but cannot dispatch. */
    canDispatch: false
    tools: OverseerToolCatalogEntry[]
}

export function buildOverseerIdentity(): OverseerIdentity {
    return {
        id: OVERSEER_ENTITY_ID,
        kind: OVERSEER_SOURCE_KIND,
        canDispatch: false,
        tools: OVERSEER_TOOL_CATALOG
    }
}

// ---------------------------------------------------------------------------
// System / voice prompt
// ---------------------------------------------------------------------------

/**
 * Build the Overseer system prompt for the dedicated voice/conversation surface.
 *
 * This is the *fleet* surface — distinct from per-session voice (which routes to
 * one worker via `messageCodingAgent`). The Overseer answers questions about the
 * whole fleet using its read-only tools. It cannot dispatch at Stage 0.
 */
export function buildOverseerSystemPrompt(): string {
    return [
        '# Identity',
        '',
        'You are the Overseer: a chief-of-staff for a fleet of autonomous coding agents ("workers").',
        'You hold a continuous view of the whole fleet and speak to the operator about it. You are not',
        'any single worker, and you never speak as one.',
        '',
        '# What you can do (Stage 0 — read only)',
        '',
        'You can READ the fleet and ANSWER questions. You have read-only tools and nothing else:',
        '',
        '- query_events — the events stream (blockers, completions, decisions, progress, errors).',
        '- query_inbox — what currently needs the operator: candidates, surfaced items, held items.',
        '- get_session_state — one session\'s observed state, activity, and reported state.',
        '- get_session_recent_output — the last few transcript chunks of a session.',
        '- get_worker_health — reported + observed + inferred state for one worker.',
        '- explain_priority — why an inbox item sits where it does, with its provenance.',
        '- list_active_workers — the current roster, filterable by project / state / age.',
        '',
        'You CANNOT dispatch, message workers, spawn, confirm, or change any state. If the operator asks',
        'you to act on a worker, say plainly that you can advise but cannot dispatch yet, and tell them',
        'what you would recommend.',
        '',
        '# How to answer',
        '',
        '- Lead with the answer, not the method. "Peer 15 is blocked on CI auth" — not "let me check".',
        '- Show receipts on request. Every claim traces to event IDs and timestamps; if the operator asks',
        '  "are you sure?" or "show your sources", recite the underlying signals.',
        '- Surface conflicts; never paper over them. If a worker says tests pass and CI says fail, say so:',
        '  "peer-15 reports pass; CI says fail — which signal are we acting on?" Do not synthesize a',
        '  confident single answer from disagreeing sources.',
        '- Prefer direct tool/system evidence over a worker\'s self-report when they conflict.',
        '- Prioritize. Surface the root cause, not five symptoms ("GitHub auth is blocking 5 workers",',
        '  not a roll-call of each blocked worker).',
        '',
        '# Voice output',
        '',
        '- Keep spoken answers to 1-3 sentences unless asked for depth.',
        '- Never read hashes, IDs, or full paths character-by-character. Say "the session ending in ZAJ".',
        '- Summarize; do not narrate a log file.'
    ].join('\n')
}

// ---------------------------------------------------------------------------
// convo_turn writeback
// ---------------------------------------------------------------------------

export type OverseerConvoTurnInput = {
    /** What the operator said. */
    operatorText: string
    /** What the Overseer answered. */
    overseerText: string
    /** Session this turn is about, if any (threads the convo to a worker). */
    relatedSessionId?: string | null
    /** Parent convo-turn event id, to thread a multi-turn exchange. */
    relatedEventId?: number | null
    /** Tool calls made while answering, for the audit/replay trail. */
    toolCalls?: Array<{ tool: OverseerToolName; argsSummary?: string }>
    ts?: number
}

export type OverseerConvoTurnEventInput = {
    ts: number
    sourceKind: typeof OVERSEER_SOURCE_KIND
    sourceRef: string
    sinkKind: 'operator'
    eventType: typeof OVERSEER_CONVO_TURN_EVENT_TYPE
    /** Memory-bearing, never an inbox item (contracts §1 / three-layer model). */
    attentionCandidate: 0
    operatorActionRequired: 0
    summary: string
    payloadJson: string
    relatedSessionId: string | null
    relatedEventId: number | null
    provenance: string
}

/** Build the `convo_turn` event-input for a single operator<->Overseer exchange. */
export function buildOverseerConvoTurnEventInput(input: OverseerConvoTurnInput): OverseerConvoTurnEventInput {
    const ts = input.ts ?? Date.now()
    const operatorText = input.operatorText.trim()
    const overseerText = input.overseerText.trim()
    const summary = operatorText.length > 0
        ? `Operator: ${operatorText.slice(0, 160)}`
        : 'Overseer conversation turn'
    return {
        ts,
        sourceKind: OVERSEER_SOURCE_KIND,
        sourceRef: OVERSEER_ENTITY_ID,
        sinkKind: 'operator',
        eventType: OVERSEER_CONVO_TURN_EVENT_TYPE,
        attentionCandidate: 0,
        operatorActionRequired: 0,
        summary,
        payloadJson: JSON.stringify({
            operatorText,
            overseerText,
            toolCalls: input.toolCalls ?? []
        }),
        relatedSessionId: input.relatedSessionId ?? null,
        relatedEventId: input.relatedEventId ?? null,
        provenance: 'overseer-convo'
    }
}
