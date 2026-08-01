/**
 * Overseer conversation — modality-agnostic core types + brain tool schemas.
 *
 * The Overseer conversation is a hub-owned core: `messages in -> brain reasons
 * and calls read-only tools -> reply out`. Text, voice, and XR are all just
 * transports over this same core; text is merely the cheapest one to build and
 * test first, and is NOT privileged over the others.
 *
 * This module owns the protocol surface shared by hub + web:
 *  - the request/response shapes for a converse turn
 *  - the OpenAI-compatible function-tool array for the 7 read-only tools,
 *    derived from the catalog + arg schemas in `overseerEntity.ts` (no extra
 *    dependency — the params are hand-mapped to stay in lock-step with the zod
 *    schemas, which are simple and stable).
 */

import {
    OVERSEER_TOOL_CATALOG,
    OVERSEER_WORKER_STATES,
    type OverseerToolName
} from './overseerEntity'
import { DISPOSITION_PREDICATE_COLUMNS, OVERSEER_DISPOSITION_ACTIONS } from './overseerInbox'

export type OverseerConverseRole = 'operator' | 'overseer'

export type OverseerConverseMessage = {
    role: OverseerConverseRole
    content: string
}

export type OverseerToolTraceEntry = {
    tool: OverseerToolName
    args: Record<string, unknown>
    ok: boolean
    /** Present when the tool call failed (bad args / not found). */
    error?: string
}

export type OverseerConverseRequest = {
    /** Full conversation so far, oldest first. Last message must be the operator. */
    messages: OverseerConverseMessage[]
    /** Optional session this conversation is threaded to (for convo_turn linkage). */
    relatedSessionId?: string | null
    /**
     * Per-request model override — swap the brain model without touching env or
     * restarting (useful for A/B-ing a frontier model against the local one on a
     * multi-model endpoint). Blank = the profile's configured model.
     */
    model?: string
    /**
     * Named brain profile to use for this request. Profiles are defined
     * server-side (url + model + key stay off the browser). Blank = default.
     */
    profile?: string
}

/** Public info about a configured brain profile (no url/key exposed). */
export type OverseerBrainProfileInfo = {
    id: string
    label: string
    model: string
    isDefault: boolean
}

export type OverseerConverseResponse = {
    /** The Overseer's spoken/typed answer — human-facing, contract-free. */
    reply: string
    /** The read-only tools the brain called while answering (audit/dogfood). */
    toolTrace: OverseerToolTraceEntry[]
    /** Model id that answered, when known. */
    model: string | null
    /**
     * False when the brain endpoint was unreachable/offline (GPU pulled for VR,
     * etc). `reply` then carries a friendly offline message; callers should not
     * treat this as an error.
     */
    brainOnline: boolean
}

// ---------------------------------------------------------------------------
// OpenAI-compatible function-tool schemas for the Overseer tool catalog
// ---------------------------------------------------------------------------

export type OverseerOpenAiTool = {
    type: 'function'
    function: {
        name: OverseerToolName
        description: string
        parameters: Record<string, unknown>
    }
}

type JsonSchema = Record<string, unknown>

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
    return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false
    }
}

const sessionIdProp: JsonSchema = { type: 'string', description: 'Exact session id (resolve a human name via list_active_workers first).' }

const detailProp: JsonSchema = {
    type: 'string',
    enum: ['lean', 'full'],
    description: 'Output detail. Default "lean" (cheap summary). Ask "full" only when you need the richer rows (e.g. the worker-health signal trail or untruncated transcript text); still bounded by limit.'
}

/** Hand-mapped params mirroring `overseerToolArgsSchemas` (kept simple + stable). */
const OVERSEER_TOOL_PARAMS: Record<OverseerToolName, JsonSchema> = {
    query_events: obj({
        sessionId: sessionIdProp,
        project: { type: 'string' },
        eventType: { type: 'string', description: 'e.g. blocked, completed, failed, needs_decision, progress, stale.' },
        sourceKind: { type: 'string', enum: ['worker', 'overseer', 'operator', 'system', 'channel'] },
        attentionCandidate: { type: 'integer', enum: [0, 1] },
        severityMin: { type: 'integer', minimum: 1, maximum: 5 },
        sinceTs: { type: 'integer', minimum: 0, description: 'Epoch ms lower bound.' },
        untilTs: { type: 'integer', minimum: 0, description: 'Epoch ms upper bound.' },
        beforeId: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        detail: detailProp
    }),
    query_inbox: obj({
        statuses: { type: 'array', items: { type: 'string' }, description: 'e.g. candidate, surfaced, held.' },
        sessionId: sessionIdProp,
        category: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        detail: detailProp
    }),
    get_session_state: obj({ sessionId: sessionIdProp, detail: detailProp }, ['sessionId']),
    get_session_recent_output: obj({
        sessionId: sessionIdProp,
        n: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent transcript chunks.' },
        detail: detailProp
    }, ['sessionId']),
    get_worker_health: obj({ sessionId: sessionIdProp, detail: detailProp }, ['sessionId']),
    explain_priority: obj({
        itemId: { type: 'integer', minimum: 1, description: 'Inbox item id.' }
    }, ['itemId']),
    list_active_workers: obj({
        project: { type: 'string' },
        state: { type: 'string', enum: [...OVERSEER_WORKER_STATES] },
        minAgeMs: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        detail: detailProp
    }),
    query_open_loops: obj({
        minAgeMs: { type: 'integer', minimum: 0, description: 'Only loops at least this old (ms). Raise it to focus on genuinely cold threads.' },
        bucket: { type: 'string', enum: ['waiting_on_you', 'half_finished'], description: 'Restrict to one bucket; omit for both (waiting_on_you first).' },
        project: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        detail: detailProp
    }),
    query_dispositions: obj({
        action: { type: 'string', enum: [...OVERSEER_DISPOSITION_ACTIONS], description: 'Filter to one disposition action.' },
        sourceKind: { type: 'string' },
        sourceRef: { type: 'string', description: 'Filter by frozen source_ref predicate.' },
        eventType: { type: 'string' },
        category: { type: 'string' },
        project: { type: 'string' },
        artifactKind: { type: 'string', description: 'Filter by frozen artifact_kind predicate (e.g. github_pr).' },
        repo: { type: 'string' },
        sinceTs: { type: 'integer', minimum: 0, description: 'Epoch ms lower bound on when the disposition was recorded.' },
        groupBy: { type: 'array', items: { type: 'string', enum: [...DISPOSITION_PREDICATE_COLUMNS] }, description: 'Switch to cluster mode: group dispositions by these predicate columns.' },
        minCount: { type: 'integer', minimum: 1, description: 'Cluster mode only: drop clusters smaller than this.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        detail: detailProp
    }),
    record_disposition: obj({
        itemId: { type: 'integer', minimum: 1, description: 'Inbox item id to dispose.' },
        action: { type: 'string', enum: [...OVERSEER_DISPOSITION_ACTIONS], description: 'done=resolve, dismiss=tombstone, snooze (needs snoozedUntil), open=reopen.' },
        feedback: { type: 'string', description: 'Optional operator note / learning label to freeze with the disposition.' },
        snoozedUntil: { type: 'integer', minimum: 1, description: 'Required for snooze: epoch ms to sleep the item until.' }
    }, ['itemId', 'action']),
    // anyOf mirrors runtime Zod: message plus at least one of sessionId|itemId.
    ping_session: {
        type: 'object',
        properties: {
            sessionId: { type: 'string', description: 'Worker session id (full UUID or unique prefix).' },
            itemId: { type: 'integer', minimum: 1, description: 'Inbox item id — resolves its relatedSessionId when sessionId omitted.' },
            message: { type: 'string', description: 'Operator-directed message to relay to that session.' }
        },
        required: ['message'],
        anyOf: [
            { required: ['sessionId'] },
            { required: ['itemId'] }
        ],
        additionalProperties: false
    }
}

/** The Overseer tool catalog (reads + disposition + relay writes) as an OpenAI `tools` array. */
export function buildOverseerOpenAiTools(): OverseerOpenAiTool[] {
    return OVERSEER_TOOL_CATALOG.map((entry) => ({
        type: 'function',
        function: {
            name: entry.name,
            description: entry.description,
            parameters: OVERSEER_TOOL_PARAMS[entry.name]
        }
    }))
}
