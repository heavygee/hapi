import type { NotifySummary } from './messages'
import { matchNotifySummaryLine } from './messages'

export const NOTIFY_SUMMARY_STATUSES = [
    'done',
    'blocked',
    'needs_review',
    'needs_decision',
    'failed',
    'stalled'
] as const

export type NotifySummaryStatus = typeof NOTIFY_SUMMARY_STATUSES[number]

/** Inline prefix injected for non-Cursor flavors on outbound user messages (#20). */
export const AGENT_NOTIFY_CONTRACT_INLINE_PREFIX = [
    'End every response with one machine-parseable line (no backticks):',
    'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}',
    'Use blocked if unsure. action must be concrete when status is done and follow-up is needed.',
    '',
    '---',
    ''
].join('\n')

/**
 * Strip the machine-only notify contract from text destined for HUMAN eyes.
 *
 * The `AGENT_NOTIFY_SUMMARY` contract rides fully in-band so it works across
 * every agent flavor, but it must never reach the human render. Two removals:
 *   1. The trailing `AGENT_NOTIFY_SUMMARY {...}` line (collapse-normalized, so
 *      Cursor's corrupted `SUMARY` variant strips too) plus any blank lines it
 *      leaves behind.
 *   2. A leading inline-contract prefix block - only present on historical
 *      operator messages stored before input-side decoupling (the hub now
 *      injects the prefix into the agent-bound copy only, never the stored one).
 *
 * Overseer event capture and notification builders MUST read the raw text, not
 * this - stripping is render-only so the machine signal survives in the store.
 */
export function stripAgentContract(text: string): string {
    if (typeof text !== 'string' || text.length === 0) return text
    let out = text

    if (out.startsWith(AGENT_NOTIFY_CONTRACT_INLINE_PREFIX)) {
        out = out.slice(AGENT_NOTIFY_CONTRACT_INLINE_PREFIX.length)
    }

    const lines = out.split('\n')
    let lastIdx = lines.length - 1
    while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx -= 1
    if (lastIdx >= 0 && matchNotifySummaryLine(lines[lastIdx])) {
        const kept = lines.slice(0, lastIdx)
        while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
        out = kept.join('\n')
    }

    return out
}

export const HAPI_EVENTS_BEGIN = '<!--HAPI_EVENTS_BEGIN-->'
export const HAPI_EVENTS_END = '<!--HAPI_EVENTS_END-->'

export const OVERSEER_STALE_SILENCE_MS = 30 * 60 * 1000

/** Cap URLs scooped from a single message (avoids tool-dump explosions). */
export const OVERSEER_LINK_SCOOP_MAX_URLS = 20

/**
 * Worker / hub-observed event_type taxonomy (contracts §1).
 * `link_seen` is hub-observed memory-bearing; captured-only by default.
 */
export const OVERSEER_EVENT_TYPES = [
    'progress',
    'tool_call',
    'tool_result',
    'commit_pushed',
    'pr_opened',
    'needs_decision',
    'needs_review',
    'blocked',
    'risk_detected',
    'approval_requested',
    'failed',
    'completed',
    'heartbeat',
    'stale',
    'validation_error',
    'convo_turn',
    'decided',
    'dispatched',
    'link_seen',
    /** Operator-pinned transcript message (hub-durable Session Log Pinned tab). */
    'operator_pin'
] as const

export type OverseerEventType = typeof OVERSEER_EVENT_TYPES[number]

/**
 * Event types whose latest occurrence per session marks a still-open loop — a
 * thread whose most recent worker status is NOT `done`. `completed` is included
 * here (not as an open type) because it is what *closes* a loop: the cold-open-
 * loops lens takes the latest event of this set per session and treats it as
 * open only when that latest event is not `completed`. `progress` is excluded
 * on purpose — a progress ping does not close an operator-owed decision.
 */
export const OVERSEER_OPEN_LOOP_EVENT_TYPES = [
    'needs_decision',
    'needs_review',
    'blocked',
    'failed',
    'stale'
] as const

export type OverseerOpenLoopEventType = typeof OVERSEER_OPEN_LOOP_EVENT_TYPES[number]

/** The event type that closes an open loop (latest `done` turn). */
export const OVERSEER_LOOP_CLOSED_EVENT_TYPE = 'completed' as const

/**
 * No-op `action` values agents stuff into a summary when nothing is actually
 * pending ("none", "complete", "n/a", …). Treated as *no action* so the lens
 * does not surface a done-shaped thread as a live loop. Matching is on the
 * trimmed, lowercased, punctuation-stripped action.
 */
const NO_OP_ACTION_VALUES = new Set([
    '',
    'none',
    'n/a',
    'na',
    'nil',
    'nothing',
    'no action',
    'no further action',
    'no followup',
    'no follow-up',
    'no follow up',
    'no-op',
    'noop',
    'complete',
    'completed',
    'done',
    'finished',
    'optional',
    'tbd'
])

/**
 * True when an `action` string is absent or a known no-op placeholder. The lens
 * keeps a loop regardless (status≠done is the strong filter), but nulls a no-op
 * action so it is not mistaken for a real next step (spec: "action is a tiebreak").
 */
export function isNoOpAction(action: string | null | undefined): boolean {
    if (action == null) return true
    const normalized = action.trim().toLowerCase().replace(/[.!\-—–\s]+$/g, '').trim()
    return normalized.length === 0 || NO_OP_ACTION_VALUES.has(normalized)
}

/** Which lens bucket an open-loop event type belongs to. */
export function openLoopBucket(eventType: string): 'waiting_on_you' | 'half_finished' {
    return eventType === 'needs_decision' || eventType === 'needs_review'
        ? 'waiting_on_you'
        : 'half_finished'
}

export type OverseerArtifactRef = {
    kind: string
    url?: string
    title?: string
    ref?: string
    source?: string
    created_at?: number
}

/** Denormalized session identity written into every overseer event payload. */
export type OverseerSessionIdentity = {
    id: string
    tag: string | null
    name: string | null
    project: string | null
    flavor: string
}

const HTTP_URL_RE = /https?:\/\/[^\s<>\[\](){}'"`]+/gi
const TRAILING_URL_PUNCT_RE = /[.,;:!?)]+$/

/**
 * Extract http(s) URLs from free text. Strips common trailing punctuation.
 * Dedupes while preserving first-seen order. Caps at OVERSEER_LINK_SCOOP_MAX_URLS.
 */
export function extractHttpUrls(text: string, max: number = OVERSEER_LINK_SCOOP_MAX_URLS): string[] {
    if (!text) return []
    const seen = new Set<string>()
    const urls: string[] = []
    HTTP_URL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HTTP_URL_RE.exec(text)) !== null) {
        const url = match[0].replace(TRAILING_URL_PUNCT_RE, '')
        if (!url || seen.has(url)) continue
        seen.add(url)
        urls.push(url)
        if (urls.length >= max) break
    }
    return urls
}

/** Stable idempotency fragment for a scooped URL (case-insensitive host/path). */
export function normalizeUrlIdempotencyKey(url: string): string {
    try {
        const parsed = new URL(url)
        parsed.hash = ''
        const host = parsed.hostname.toLowerCase()
        const path = parsed.pathname.replace(/\/+$/, '') || ''
        const search = parsed.search
        return `${parsed.protocol}//${host}${path}${search}`
    } catch {
        return url.trim().toLowerCase()
    }
}

export function buildUrlArtifactRefs(
    urls: string[],
    source: string = 'inferred',
    createdAt: number = Date.now()
): OverseerArtifactRef[] {
    return urls.map((url) => ({
        kind: 'url',
        url,
        source,
        created_at: createdAt
    }))
}

export function operatorPinIdempotencyKey(sessionId: string, messageId: string): string {
    return `session:${sessionId}:message:${messageId}:operator_pin`
}

export function buildLinkSeenSummary(url: string): string {
    try {
        const parsed = new URL(url)
        const path = parsed.pathname === '/' ? '' : parsed.pathname
        const display = `${parsed.hostname}${path}`
        return display.length > 120 ? `Link seen: ${display.slice(0, 117)}...` : `Link seen: ${display}`
    } catch {
        const trimmed = url.length > 120 ? `${url.slice(0, 117)}...` : url
        return `Link seen: ${trimmed}`
    }
}

export function deriveSessionDisplayName(
    metadata: { name?: string } | null | undefined,
    tag?: string | null
): string | null {
    const name = metadata?.name?.trim()
    if (name) return name
    const tagValue = tag?.trim()
    return tagValue || null
}

/**
 * Angle-bracket prompt tokens (`<project>`, `<agent-id>`) are examples, not
 * real workspace / agent ids. Treat them as absent so payload.session.project
 * stays the derived path basename and tags do not poison project queries.
 */
export function usableNotifyToken(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^<[^>]+>$/.test(trimmed)) return null
    return trimmed
}

/** Sentinel / example `action` values are not operator work. */
export function usableNotifyAction(value: string | null | undefined): string | null {
    const token = usableNotifyToken(value)
    if (!token) return null
    const lower = token.toLowerCase()
    if (['none', 'n/a', 'na', 'nil', 'null', '-', 'n.a.'].includes(lower)) return null
    if (/^<=?\s*12\s+words$/i.test(token)) return null
    return token
}

export function deriveSessionProject(
    metadata: { path?: string; worktree?: { name?: string } } | null | undefined
): string | null {
    if (!metadata) return null
    const worktreeName = metadata.worktree?.name?.trim()
    if (worktreeName) return worktreeName
    const path = metadata.path?.trim()
    if (!path) return null
    const parts = path.split(/[/\\]/).filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1]! : null
}

export function buildOverseerSessionIdentity(input: {
    id: string
    flavor: string
    tag?: string | null
    metadata?: { name?: string; path?: string; worktree?: { name?: string } } | null
    notifyProject?: string | null
}): OverseerSessionIdentity {
    const tag = input.tag ?? null
    const derivedProject = deriveSessionProject(input.metadata)
    const notifyProject = usableNotifyToken(input.notifyProject)
    return {
        id: input.id,
        tag,
        name: deriveSessionDisplayName(input.metadata, tag),
        project: notifyProject || derivedProject,
        flavor: input.flavor
    }
}

export function mergeEventPayloadWithSession(
    payloadFields: Record<string, unknown>,
    session: OverseerSessionIdentity
): string {
    return JSON.stringify({
        ...payloadFields,
        session: {
            id: session.id,
            tag: session.tag,
            name: session.name,
            project: session.project,
            flavor: session.flavor
        }
    })
}

export function mapNotifyStatusToEventType(status: string | undefined): string {
    switch (status) {
        case 'done':
            return 'completed'
        case 'blocked':
            return 'blocked'
        case 'needs_review':
            return 'needs_review'
        case 'needs_decision':
            return 'needs_decision'
        case 'failed':
            return 'failed'
        case 'stalled':
            return 'stale'
        default:
            return 'progress'
    }
}

export function deriveAttentionCandidate(status: string | undefined, action?: string): 0 | 1 {
    switch (status) {
        case 'needs_decision':
        case 'blocked':
        case 'failed':
        case 'needs_review':
        case 'stalled':
            return 1
        case 'done':
            return usableNotifyAction(action) ? 1 : 0
        default:
            return 0
    }
}

export function deriveOperatorActionRequired(status: string | undefined, action?: string): 0 | 1 {
    return deriveAttentionCandidate(status, action)
}

export function deriveSeverity(eventType: string): number {
    switch (eventType) {
        case 'approval_requested':
        case 'permission_request':
        case 'needs_decision':
            return 5
        case 'blocked':
        case 'failed':
            return 4
        case 'needs_review':
        case 'stale':
            return 3
        case 'completed':
            return 2
        case 'link_seen':
        case 'operator_pin':
            return 1
        default:
            return 1
    }
}

/** Default attention_candidate for known taxonomy types (safer default: false). */
export function defaultAttentionCandidate(eventType: string): 0 | 1 {
    switch (eventType) {
        case 'commit_pushed':
        case 'pr_opened':
        case 'needs_decision':
        case 'needs_review':
        case 'blocked':
        case 'risk_detected':
        case 'approval_requested':
        case 'failed':
            return 1
        case 'link_seen':
        case 'operator_pin':
        case 'progress':
        case 'tool_call':
        case 'tool_result':
        case 'heartbeat':
        case 'convo_turn':
        case 'decided':
        case 'dispatched':
        case 'stale':
        case 'validation_error':
        default:
            return 0
    }
}

export function buildEventSummaryFromNotify(notify: NotifySummary): string {
    const summary = notify.summary?.trim()
    if (summary) return summary
    const action = notify.action?.trim()
    if (action) return action
    const status = notify.status?.trim()
    if (status) return `Agent status: ${status}`
    return 'Agent turn summary'
}

export function detectEmptyHapiEventsSentinel(text: string): boolean {
    const pattern = new RegExp(
        `${escapeRegExp(HAPI_EVENTS_BEGIN)}\\s*${escapeRegExp(HAPI_EVENTS_END)}`,
        'm'
    )
    return pattern.test(text)
}

export function detectMalformedNotifySummaryLine(text: string): boolean {
    const lines = text.split('\n')
    let lastIdx = lines.length - 1
    while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx -= 1
    if (lastIdx < 0) return false
    const lastLine = lines[lastIdx].trim()
    if (!lastLine.startsWith('AGENT_NOTIFY_SUMMARY ')) return false
    const jsonPart = lastLine.slice('AGENT_NOTIFY_SUMMARY '.length).trim()
    if (!jsonPart.startsWith('{')) return true
    try {
        JSON.parse(jsonPart)
        return false
    } catch {
        return true
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
