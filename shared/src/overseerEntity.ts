/**
 * Overseer entity — Step 3 (read-only tools + Stage 1 disposition write).
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
import { DISPOSITION_PREDICATE_COLUMNS, OVERSEER_DISPOSITION_ACTIONS } from './overseerInbox'
import type { DispositionPredicateColumn, InboxItemStatus, InboxOperatorAction, OverseerDispositionAction } from './overseerInbox'

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
    /** Session display name when the related session still exists in the hub. */
    relatedSessionName: string | null
    /** Hub `active` flag for the related session; null when the session row is gone. */
    relatedSessionActive: boolean | null
    /** Inbox item summary (action line) — often more useful than a bare URL title. */
    summary: string
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
    'list_active_workers',
    'query_open_loops',
    'query_dispositions',
    'record_disposition',
    'ping_session'
] as const

export type OverseerToolName = typeof OVERSEER_TOOL_NAMES[number]

/**
 * Write tools (Stage 1+). Every other tool is read-only against the substrate.
 * `record_disposition` = operator decision on an inbox item; `ping_session` = relay
 * a message to a worker session (resume + enqueue). Both are operator-directed only (R2/R5).
 */
export const OVERSEER_WRITE_TOOL_NAMES = ['record_disposition', 'ping_session'] as const
export type OverseerWriteToolName = typeof OVERSEER_WRITE_TOOL_NAMES[number]

export function isOverseerWriteTool(name: string): name is OverseerWriteToolName {
    return (OVERSEER_WRITE_TOOL_NAMES as readonly string[]).includes(name)
}

const sessionIdSchema = z.string().min(1)

/**
 * Output-detail knob shared by every context-gathering tool. `lean` (default)
 * returns the cheap brain-facing shape; `full` returns the richer rows (still
 * bounded by `limit`/`n`). Two levels only — no token-budget engine. The knob is
 * consumed by the converse projection layer; the entity methods ignore it.
 */
export const toolDetailSchema = z.enum(['lean', 'full'])
export type ToolResultDetailArg = z.infer<typeof toolDetailSchema>

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
    limit: z.number().int().min(1).max(200).optional(),
    detail: toolDetailSchema.optional()
})
export type QueryEventsArgs = z.infer<typeof queryEventsArgsSchema>

export const queryInboxArgsSchema = z.object({
    statuses: z.array(z.string().min(1)).min(1).optional(),
    sessionId: sessionIdSchema.optional(),
    category: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    detail: toolDetailSchema.optional()
})
export type QueryInboxArgs = z.infer<typeof queryInboxArgsSchema>

export const getSessionStateArgsSchema = z.object({
    sessionId: sessionIdSchema,
    detail: toolDetailSchema.optional()
})
export type GetSessionStateArgs = z.infer<typeof getSessionStateArgsSchema>

export const getSessionRecentOutputArgsSchema = z.object({
    sessionId: sessionIdSchema,
    n: z.number().int().min(1).max(50).optional(),
    detail: toolDetailSchema.optional()
})
export type GetSessionRecentOutputArgs = z.infer<typeof getSessionRecentOutputArgsSchema>

export const getWorkerHealthArgsSchema = z.object({
    sessionId: sessionIdSchema,
    detail: toolDetailSchema.optional()
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
    limit: z.number().int().min(1).max(200).optional(),
    detail: toolDetailSchema.optional()
})
export type ListActiveWorkersArgs = z.infer<typeof listActiveWorkersArgsSchema>

export const queryOpenLoopsArgsSchema = z.object({
    /** Only loops at least this old (ms) — the "went cold" knob. Default 0. */
    minAgeMs: z.number().int().nonnegative().optional(),
    /** Restrict to one lens bucket. Default: both, waiting_on_you first. */
    bucket: z.enum(['waiting_on_you', 'half_finished']).optional(),
    project: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    detail: toolDetailSchema.optional()
})
export type QueryOpenLoopsArgs = z.infer<typeof queryOpenLoopsArgsSchema>

const dispositionPredicateColumnSchema = z.enum(DISPOSITION_PREDICATE_COLUMNS)
const overseerDispositionActionSchema = z.enum(OVERSEER_DISPOSITION_ACTIONS)

/**
 * `query_dispositions` (R3): one reader, two modes on the same row shape.
 *  - list mode (default): recorded disposition rows, newest first, filtered by the predicate vocabulary.
 *  - cluster mode (`groupBy` set): `GROUP BY(groupBy)` + `HAVING count>=minCount` — the discovery watcher.
 */
export const queryDispositionsArgsSchema = z.object({
    action: overseerDispositionActionSchema.optional(),
    sourceKind: z.string().min(1).optional(),
    sourceRef: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    artifactKind: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    sinceTs: z.number().int().nonnegative().optional(),
    /** Set to switch to cluster/discovery mode. Columns from the R8 predicate vocabulary. */
    groupBy: z.array(dispositionPredicateColumnSchema).min(1).optional(),
    /** Cluster mode only: minimum rows per cluster (`HAVING`). Default 1. */
    minCount: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    detail: toolDetailSchema.optional()
})
export type QueryDispositionsArgs = z.infer<typeof queryDispositionsArgsSchema>

/**
 * `record_disposition` — the keystone write. An explicit operator decision on one inbox item:
 * resolve (`done`), tombstone (`dismiss`), snooze, or reopen (`open`). Records the as-seen R8
 * snapshot and returns a tombstone the brain reads back. Never invented by the brain on its own
 * judgement in P1 — invoked only when the operator directs a disposition in the conversation.
 */
export const recordDispositionArgsSchema = z.object({
    itemId: z.number().int().positive(),
    action: overseerDispositionActionSchema,
    /** Optional operator note / learning label frozen with the disposition. */
    feedback: z.string().min(1).max(2000).optional(),
    /** Required for `snooze`: epoch ms to sleep the item until. */
    snoozedUntil: z.number().int().positive().optional()
})
export type RecordDispositionArgs = z.infer<typeof recordDispositionArgsSchema>

/**
 * `ping_session` — relay an operator-directed message to one worker session (R5).
 * Resolves by `sessionId` (full id or unique prefix) and/or `itemId` (inbox item →
 * relatedSessionId). Hub resumes if inactive, then enqueues the message — same
 * primitives as `hapi-ping-peer`, called in-process (never shell out).
 */
export const pingSessionArgsSchema = z.object({
    sessionId: z.string().min(1).max(128).optional(),
    itemId: z.number().int().positive().optional(),
    message: z.string().min(1).max(8000),
}).refine((v) => Boolean(v.sessionId?.trim()) || typeof v.itemId === 'number', {
    message: 'sessionId or itemId is required'
})
export type PingSessionArgs = z.infer<typeof pingSessionArgsSchema>

export type OverseerPingResult = {
    ok: boolean
    sessionId: string
    sessionName: string | null
    project: string | null
    /** True when the hub had to resume before sending. */
    resumed: boolean
    /** One-line human confirmation to read back ("Relayed to Expenses (a492…): …"). */
    tombstone: string
    error?: string
}

/**
 * One cold open loop: a session whose latest worker status is not `done`,
 * carrying how long it has sat and which lens bucket it belongs to.
 */
export type OverseerOpenLoop = {
    sessionId: string
    name: string | null
    project: string | null
    flavor: string | null
    /** Worker notify status (needs_decision / blocked / failed / …). */
    status: string
    /** Stored event_type of the latest open event. */
    eventType: string
    eventId: number
    /** Concrete next step, or null when the agent left a no-op placeholder. */
    action: string | null
    summary: string
    lastTs: number
    ageMs: number
    ageDays: number
    bucket: 'waiting_on_you' | 'half_finished'
}

export type OverseerOpenLoopsResult = {
    openLoops: OverseerOpenLoop[]
    counts: { total: number; waitingOnYou: number; halfFinished: number }
}

/** One recorded disposition row (list mode), thinned to the predicate vocabulary + as-seen title. */
export type OverseerDispositionRow = {
    id: number
    itemId: number
    action: InboxOperatorAction
    statusAfter: string
    feedback: string | null
    createdAt: number
    sourceKind: string | null
    sourceRef: string | null
    eventType: string | null
    category: string | null
    project: string | null
    artifactKind: string | null
    repo: string | null
    title: string | null
}

/** One disposition cluster (cluster mode): the predicate key tuple + counts (R3 discovery shape). */
export type OverseerDispositionCluster = {
    keys: Partial<Record<DispositionPredicateColumn, string | null>>
    count: number
    actions: Record<string, number>
    lastCreatedAt: number
}

export type OverseerDispositionsResult = {
    mode: 'list' | 'cluster'
    rows?: OverseerDispositionRow[]
    clusters?: OverseerDispositionCluster[]
    total: number
}

/** Result of the keystone write — the tombstone the brain reads back after a disposition lands. */
export type OverseerDispositionResult = {
    ok: boolean
    itemId: number
    action: OverseerDispositionAction
    statusAfter: string
    /** One-line human confirmation ("Marked #42 done — QUESTION / hapi …"). */
    tombstone: string
}

export const overseerToolArgsSchemas = {
    query_events: queryEventsArgsSchema,
    query_inbox: queryInboxArgsSchema,
    get_session_state: getSessionStateArgsSchema,
    get_session_recent_output: getSessionRecentOutputArgsSchema,
    get_worker_health: getWorkerHealthArgsSchema,
    explain_priority: explainPriorityArgsSchema,
    list_active_workers: listActiveWorkersArgsSchema,
    query_open_loops: queryOpenLoopsArgsSchema,
    query_dispositions: queryDispositionsArgsSchema,
    record_disposition: recordDispositionArgsSchema,
    ping_session: pingSessionArgsSchema
} as const satisfies Record<OverseerToolName, z.ZodTypeAny>

export type OverseerToolCatalogEntry = {
    name: OverseerToolName
    description: string
    /** `false` marks the single write tool (`record_disposition`); every other entry is read-only (R2). */
    readonly: boolean
}

/** Catalog surfaced to the voice/system layer; write tools are marked `readonly: false` (R2). */
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
        description: 'Hub-observed state for one session (full id or unique short prefix): activity, tool-call recency, pending requests, and the worker-reported state when available. Inactive sessions still return a state object (active:false) — null means no matching session, not "deleted".',
        readonly: true
    },
    {
        name: 'get_session_recent_output',
        description: 'Last N transcript chunks for one session (full id or unique short prefix).',
        readonly: true
    },
    {
        name: 'get_worker_health',
        description: 'Combined worker health for one session (full id or unique short prefix): reported + observed + inferred state with a signal trail (never collapses a reported/observed conflict).',
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
    },
    {
        name: 'query_open_loops',
        description: 'The "what am I forgetting?" lens: threads whose latest worker status is NOT done (needs_decision / needs_review / blocked / failed / stalled) and never got closed, sorted coldest-first. "Waiting on You" (a decision the operator owes) is bucketed separately from half-finished work. Neglect-axis, not priority — use this for "what have I abandoned / forgotten?", not "what is most urgent?".',
        readonly: true
    },
    {
        name: 'query_dispositions',
        description: 'Read past operator dispositions (done / dismiss / snooze / open) with the as-seen snapshot. List mode returns recent rows; set groupBy (e.g. ["category","project"]) with minCount to cluster them — the shape standing-order discovery uses to find "you always do X to this kind of item".',
        readonly: true
    },
    {
        name: 'record_disposition',
        description: 'WRITE: record the operator\'s explicit decision on one inbox item — done (resolve), dismiss (tombstone), snooze (needs snoozedUntil), or open (reopen). Only call this when the operator has clearly directed it in the conversation; never on your own judgement. Returns a tombstone to read back.',
        readonly: false
    },
    {
        name: 'ping_session',
        description: 'WRITE: relay an operator-directed message to one worker session (resume if inactive, then enqueue). Pass sessionId (full id or unique prefix) and/or itemId (inbox item → its related session). Only call when the operator has clearly said to tell / ping / ask that project or agent something. Irreversible once delivered — never invent a ping.',
        readonly: false
    }
]

/** Whether the Overseer may write dispositions — Stage 1 keystone gate (still no dispatch). */
export function overseerCanDisposition(): boolean {
    return OVERSEER_TOOL_CATALOG.some((t) => t.name === 'record_disposition' && !t.readonly)
}

/** Whether the Overseer may relay to a worker session — Stage 1.5 delegation gate (R5). */
export function overseerCanRelay(): boolean {
    return OVERSEER_TOOL_CATALOG.some((t) => t.name === 'ping_session' && !t.readonly)
}

export type OverseerIdentity = {
    id: string
    kind: typeof OVERSEER_SOURCE_KIND
    /** Still no dispatch — the Overseer never spawns or drives a worker. */
    canDispatch: false
    /** Stage 1 keystone: the Overseer may record operator-directed dispositions on inbox items. */
    canDisposition: boolean
    /** Stage 1.5: the Overseer may relay operator-directed messages to a worker session. */
    canRelay: boolean
    tools: OverseerToolCatalogEntry[]
}

export function buildOverseerIdentity(): OverseerIdentity {
    return {
        id: OVERSEER_ENTITY_ID,
        kind: OVERSEER_SOURCE_KIND,
        canDispatch: false,
        canDisposition: overseerCanDisposition(),
        canRelay: overseerCanRelay(),
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
        '# What you can do (Stage 1.5 — read + dispositions + relay)',
        '',
        'You can READ the fleet, ANSWER questions, RECORD the operator\'s decisions on inbox items,',
        'and RELAY an operator-directed message to one worker session.',
        '',
        'Read-only tools:',
        '- query_events — the events stream (blockers, completions, decisions, progress, errors).',
        '- query_inbox — what currently needs the operator: candidates, surfaced items, held items.',
        '- get_session_state — one session\'s observed state, activity, and reported state',
        '  (sessionId: full UUID or unique short prefix; inactive sessions still return a state',
        '  object with active:false — null means no match, NOT that the session was deleted).',
        '- get_session_recent_output — the last few transcript chunks of a session (same id rules).',
        '- get_worker_health — reported + observed + inferred state for one worker (same id rules).',
        '- explain_priority — why an inbox item sits where it does, with its provenance.',
        '- list_active_workers — the current roster, filterable by project / state / age.',
        '- query_open_loops — the "what am I forgetting?" lens: cold threads whose latest status is not done.',
        '- query_dispositions — past operator decisions (list, or groupBy+minCount to cluster them).',
        '',
        'Write tools (the ONLY things you can change):',
        '- record_disposition — record the operator\'s decision on ONE inbox item: done (resolve),',
        '  dismiss (tombstone), snooze (needs snoozedUntil), or open (reopen).',
        '- ping_session — relay a message to ONE worker session (resume if needed, then enqueue).',
        '  Pass sessionId and/or itemId. Irreversible once delivered.',
        '',
        'You still CANNOT spawn new workers, invent work, or confirm anything on a worker\'s behalf.',
        'If the operator asks you to "just handle it" without naming a target and an intent, ask.',
        '',
        '# Recording a disposition (be careful — this writes)',
        '',
        '- Call record_disposition ONLY when the operator has clearly directed a decision on a specific',
        '  item ("mark that done", "dismiss the PR-flood one", "snooze it till tomorrow"). Never decide',
        '  on your own judgement, and never dispose of an item the operator was only asking ABOUT.',
        '- If which item is ambiguous, ask which one before writing. Identify the item first (query_inbox',
        '  / explain_priority) so you pass the right itemId.',
        '- After it lands, read the returned tombstone back in one line so the operator knows it stuck.',
        '',
        '# Relaying to a project / session (be careful — this writes and is not undoable)',
        '',
        '- Call ping_session ONLY when the operator has clearly directed a relay: "tell that expenses',
        '  session…", "ping the hapi peer about…", "ask that project to…". Never invent a ping.',
        '- Prefer itemId when the conversation is about a specific inbox item (it resolves the related',
        '  session). Otherwise use sessionId (full id or unique short prefix).',
        '- Keep the message short and complete — the worker rehydrates its own context; you are a',
        '  secretary passing intent, not transferring your whole briefing.',
        '- After it lands, read the returned tombstone back in one line.',
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
        '- When the operator asks about a SPECIFIC inbox item, first call explain_priority for its',
        '  provenance, then query_events with that item\'s relatedSessionId (full UUID from the tool',
        '  result — do not truncate it yourself) to pull the rest of that session\'s recorded activity',
        '  as context/salience before answering — do not answer from the item alone.',
        '- Prefer relatedSessionId / session fields from tool results over inventing short prefixes.',
        '  Unique short prefixes are accepted by session tools, but truncating a UUID is how you get',
        '  false "session missing" answers.',
        '- An inbox item can still need a decision after its worker goes idle/complete — that is not',
        '  a ghost. Check get_session_state (expect active:false + reported/observed) before claiming',
        '  the session is gone.',
        '',
        '# Two questions, two axes',
        '',
        'Urgency and neglect are different axes; do not conflate them.',
        '',
        '- "What needs me now?" / "what is most urgent?" → an URGENCY question. Use query_inbox (and',
        '  explain_priority), which are priority-ordered.',
        '- "What am I forgetting / abandoning / neglecting?" / "what have I not touched?" → a NEGLECT',
        '  question. Use query_open_loops, which is age-sorted (coldest first) over threads whose latest',
        '  status is not done. Lead with the "Waiting on You" bucket (a decision the operator owes), then',
        '  half-finished work. A very old low-priority loop can matter here even if it is not urgent.',
        '',
        '# Priority direction (do not get this backwards)',
        '',
        'Inbox priority is LOWER-IS-HIGHER: priority 1 is the MOST important, priority 90 is the LEAST.',
        'Never call a high number "highest priority". When you sort or rank by priority, the smallest',
        'number comes first. If you cite a number, say e.g. "priority 5 (near the top)".',
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
