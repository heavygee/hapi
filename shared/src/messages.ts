import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { AGENT_MESSAGE_PAYLOAD_TYPE } from './modes'
import { isObject } from './utils'

type RoleWrappedRecord = {
    role: string
    content: unknown
    meta?: unknown
}

const VISIBLE_CLAUDE_SYSTEM_SUBTYPES = new Set([
    'api_error',
    'turn_duration',
    'microcompact_boundary',
    'compact_boundary',
    // Auto-generated recap Claude Code's local TUI writes to the transcript on
    // window blur/focus (5min+ idle). Only observed via the local launcher's
    // transcript scan — SDK/remote mode never emits it. Chat-visible here also
    // means CLI-forwarded, web-rendered, and included in session export
    // (parity with turn_duration / compact_boundary).
    'away_summary'
])

export function isRoleWrappedRecord(value: unknown): value is RoleWrappedRecord {
    if (!isObject(value)) return false
    return typeof value.role === 'string' && 'content' in value
}

export function unwrapRoleWrappedRecordEnvelope(value: unknown): RoleWrappedRecord | null {
    if (isRoleWrappedRecord(value)) return value
    if (!isObject(value)) return null

    const direct = value.message
    if (isRoleWrappedRecord(direct)) return direct

    const data = value.data
    if (isObject(data) && isRoleWrappedRecord(data.message)) return data.message as RoleWrappedRecord

    const payload = value.payload
    if (isObject(payload) && isRoleWrappedRecord(payload.message)) return payload.message as RoleWrappedRecord

    return null
}

export function isClaudeChatVisibleSystemSubtype(subtype: unknown): subtype is string {
    return typeof subtype === 'string' && VISIBLE_CLAUDE_SYSTEM_SUBTYPES.has(subtype)
}

export function isClaudeChatVisibleMessage(message: { type: unknown; subtype?: unknown }): boolean {
    if (message.type === 'rate_limit_event') {
        return false
    }

    if (message.type === 'tool_progress') {
        return false
    }

    if (message.type !== 'system') {
        return true
    }

    return isClaudeChatVisibleSystemSubtype(message.subtype)
}

export function isRedundantGoalStatusMessageText(value: unknown): boolean {
    if (typeof value !== 'string') return false
    const message = value.trim()
    return message === 'Goal cleared'
        || /^Goal (active|paused|complete|blocked|limited by (?:budget|usage))(?:$|\s+·\s+)/.test(message)
}

/**
 * ACP agents stream thoughts one token at a time, so the CLI coalesces them
 * into a buffer and re-sends the whole buffer under a stable stream id every
 * few hundred milliseconds. Every snapshot but the newest is dead weight: the
 * buffer only ever grows, so an older snapshot is a strict prefix of a newer
 * one and the timeline collapses them back into a single block anyway.
 *
 * These two readers let the hub and the web keep one message per stream
 * instead of one per snapshot. They are deliberately separate:
 *
 *  - `getReasoningStreamId` answers "which stream does this belong to" and so
 *    also matches the settled message that closes a stream. That message is
 *    what triggers the final cleanup of its own leftovers.
 *  - `getLiveReasoningStreamId` answers "is this a replaceable snapshot", and
 *    so only ever matches something safe to drop.
 *
 * Anything unrecognised reads as `null`, which means "keep it".
 */
function readReasoningStreamId(value: unknown, liveOnly: boolean): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record?.role !== 'agent') return null

    const content = record.content
    if (!isObject(content) || content.type !== AGENT_MESSAGE_PAYLOAD_TYPE) return null

    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'reasoning') return null
    if (liveOnly && data.live !== true) return null

    const id = data.id
    if (typeof id !== 'string' || id.trim().length === 0) return null
    return id
}

export function getReasoningStreamId(value: unknown): string | null {
    return readReasoningStreamId(value, false)
}

export function getLiveReasoningStreamId(value: unknown): string | null {
    return readReasoningStreamId(value, true)
}

export function isRedundantGoalStatusEventContent(value: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record?.role !== 'agent') return false

    const eventContent = record.content
    if (!isObject(eventContent) || eventContent.type !== 'event') return false

    const data = isObject(eventContent.data) ? eventContent.data : null
    if (!data || data.type !== 'message') return false

    return isRedundantGoalStatusMessageText(data.message)
}

/**
 * Best-effort plain-text extraction from a stored agent message's `content`.
 *
 * Two structural shapes are common in this fork:
 *
 *  1. `codex` flavor:  content.type = 'codex',  content.data.type = 'message'
 *     -> assistant text at `content.data.message` (string).
 *
 *  2. `output` flavor (Claude SDK passthrough):  content.type = 'output',
 *     content.data.type = 'assistant'  -> text at
 *     `content.data.message.content[i].text` (array of `{type:'text', text}`).
 *
 * Returns `null` when the content does not look like assistant *text*
 * (tool calls, tool results, reasoning, token counts, etc.) so callers can
 * skip those messages and fall back to the previous one.
 */
export function extractAssistantPlainText(content: unknown): string | null {
    if (!isObject(content)) return null

    if (content.type === 'codex') {
        const data = isObject(content.data) ? content.data : null
        if (!data || data.type !== 'message') return null
        return typeof data.message === 'string' && data.message.length > 0
            ? data.message
            : null
    }

    if (content.type === 'output') {
        const data = isObject(content.data) ? content.data : null
        if (!data) return null

        // AGY planner prose (cli wraps PLANNER_RESPONSE as agy_message).
        if (data.type === 'agy_message') {
            return typeof data.content === 'string' && data.content.trim().length > 0
                ? data.content
                : null
        }

        if (data.type !== 'assistant') return null
        const message = isObject(data.message) ? data.message : null
        if (typeof data.message === 'string' && data.message.trim().length > 0) {
            return data.message
        }
        const blocks = Array.isArray(message?.content) ? message.content : null
        if (!blocks) return null
        const textParts: string[] = []
        for (const block of blocks) {
            if (!isObject(block)) continue
            if (block.type === 'text' && typeof block.text === 'string') {
                textParts.push(block.text)
            }
        }
        if (textParts.length === 0) return null
        return textParts.join('\n')
    }

    return null
}

export const NOTIFY_SUMMARY_TOKEN = 'AGENT_NOTIFY_SUMMARY'
// AGY sometimes echoes an async task's raw result into its own PLANNER_RESPONSE
// prose. The web renderer strips this block and renders the corresponding task
// result separately, so keep it out of the searchable assistant text as well.
export function stripAgyEchoedTaskResult(text: string): string {
    return text.replace(/\n*\[Message\]\s+timestamp=[\s\S]*$/, '').trim()
}

// AGY's transitional task-log narration is rendered as a compact tool chip,
// not an assistant text bubble. Return its task number for renderer/index parity.
export function getAgyTaskLogId(text: string): string | null {
    return text.match(/^Inside the task-(\d+) log\b/)?.[1] ?? null
}

function normalizeSearchablePlainText(value: string): string | null {
    const text = value.trim().replace(/\s+/g, ' ')
    return text.length > 0 ? text : null
}

function normalizeSearchableMarkdownText(value: string): string | null {
    try {
        return normalizeSearchablePlainText(toString(fromMarkdown(value)))
    } catch {
        // Keep indexing malformed/incomplete streamed Markdown rather than
        // dropping otherwise visible assistant text.
        return normalizeSearchablePlainText(value)
    }
}

export function extractUserPlainText(content: unknown): string | null {
    if (typeof content === 'string') {
        return normalizeSearchablePlainText(content)
    }

    const blocks = Array.isArray(content) ? content : [content]
    const textParts = blocks
        .map((block) => {
            if (!isObject(block) || block.type !== 'text' || typeof block.text !== 'string') {
                return null
            }
            return block.text
        })
        .filter((text): text is string => text !== null)

    return normalizeSearchablePlainText(textParts.join(' '))
}

function extractClaudeUserPlainText(content: unknown): string | null {
    if (!isObject(content) || content.type !== 'output') return null
    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'user' || Boolean(data.isSidechain)) return null

    const message = isObject(data.message) ? data.message : null
    const blocks = Array.isArray(message?.content) ? message.content : null
    if (!blocks || blocks.length === 0 || !blocks.every((block) => (
        isObject(block) && block.type === 'text' && typeof block.text === 'string'
    ))) return null

    return extractUserPlainText(blocks)
}

export type SearchableMessage = {
    role: 'user' | 'assistant'
    text: string
    /** Stable renderer identity used to coalesce streamed assistant snapshots. */
    renderKey?: string
}

function getMessageRenderKey(content: unknown): string | undefined {
    if (!isObject(content)) return undefined

    if (content.type === 'codex') {
        const data = isObject(content.data) ? content.data : null
        if (data?.type === 'message' && typeof data.id === 'string' && data.id.length > 0) {
            return data.id
        }
    }

    if (content.type === 'text' && typeof content.streamId === 'string' && content.streamId.length > 0) {
        return content.streamId
    }

    return undefined
}

/** Return the renderer identity for a visible message, even when it has no text. */
export function extractMessageRenderKey(value: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (!record || (record.role !== 'agent' && record.role !== 'assistant')) return null
    return getMessageRenderKey(record.content) ?? null
}

/** Return whether a message is a cumulative live stream snapshot. */
export function isLiveStreamSnapshot(value: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (!record || (record.role !== 'agent' && record.role !== 'assistant')) return false
    if (!isObject(record.content)) return false

    if (record.content.type === 'codex') {
        const data = isObject(record.content.data) ? record.content.data : null
        return data?.type === 'message' && data.streamSnapshot === true && data.live === true
    }

    return record.content.type === 'text'
        && record.content.streamSnapshot === true
        && record.content.live === true
}

function isHiddenAssistantOutput(content: unknown): boolean {
    if (!isObject(content) || content.type !== 'output') return false
    const data = isObject(content.data) ? content.data : null
    return Boolean(data?.isMeta) || Boolean(data?.isCompactSummary) || Boolean(data?.isSidechain)
}

/** Extract only user-visible user/assistant prose from a stored role envelope. */
export function extractSearchableMessageText(value: unknown): SearchableMessage | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (!record) return null

    if (record.role === 'user') {
        const text = extractUserPlainText(record.content)
        return text ? { role: 'user', text } : null
    }

    if (record.role === 'agent' || record.role === 'assistant') {
        if (isHiddenAssistantOutput(record.content)) return null
        const claudeUserText = extractClaudeUserPlainText(record.content)
        if (claudeUserText) return { role: 'user', text: claudeUserText }
        const renderKey = getMessageRenderKey(record.content)
        const isAgyPlannerMessage = isObject(record.content)
            && record.content.type === 'output'
            && isObject(record.content.data)
            && record.content.data.type === 'agy_message'
        const directText = typeof record.content === 'string'
            ? record.content
            : isObject(record.content)
                && record.content.type === 'text'
                && typeof record.content.text === 'string'
                ? record.content.text
                : null
        const rawText = stripNotifySummaryFooter(
            isAgyPlannerMessage
                ? stripAgyEchoedTaskResult(directText ?? extractAssistantPlainText(record.content) ?? '')
                : (directText ?? extractAssistantPlainText(record.content) ?? '')
        )
        const text = normalizeSearchableMarkdownText(rawText)
        if (!text || (isAgyPlannerMessage && getAgyTaskLogId(normalizeSearchablePlainText(rawText) ?? ''))) return null
        return { role: 'assistant', text, ...(renderKey ? { renderKey } : {}) }
    }

    return null
}

const NOTIFY_SUMMARY_PREFIX = 'AGENT_NOTIFY_SUMMARY '

export type NotifySummary = {
    version?: number
    agent?: string
    project?: string
    status?: string
    action?: string
    summary?: string
}

/**
 * Collapse every run of a repeated character down to a single instance
 * (`"SUMMARY"` -> `"SUMARY"`, `"aaa-bb"` -> `"a-b"`).
 *
 * Corruption-normalizer for the notify contract. Observed in the wild (354k
 * stored messages): Cursor drops one of a doubled letter in roughly 1 of 7
 * turns, mangling `AGENT_NOTIFY_SUMMARY` -> `AGENT_NOTIFY_SUMARY`.
 */
export function collapseRepeats(value: string): string {
    return value.replace(/(.)\1+/g, '$1')
}

const NOTIFY_SUMMARY_TOKEN_NORM = collapseRepeats(NOTIFY_SUMMARY_TOKEN)

function findNotifyTokenStart(before: string): number {
    for (let i = 0; i < before.length; i++) {
        const candidate = before.slice(i)
        if (/\s/.test(candidate)) continue
        if (collapseRepeats(candidate) === NOTIFY_SUMMARY_TOKEN_NORM) return i
    }
    return -1
}

/**
 * Match a well-formed `AGENT_NOTIFY_SUMMARY {...}` footer on a single line.
 *
 * Corruption-tolerant token match plus upstream glued-prose / whitespace rules.
 */
export type NotifySummaryLineMatch = {
    jsonPart: string
    start: number
}

export function matchNotifySummaryLine(line: string): NotifySummaryLineMatch | null {
    const trimmedEnd = line.trimEnd()
    if (!trimmedEnd.endsWith('}')) return null

    let matched: NotifySummaryLineMatch | null = null
    for (let braceIdx = 0; braceIdx < trimmedEnd.length; braceIdx++) {
        if (trimmedEnd[braceIdx] !== '{') continue
        const before = trimmedEnd.slice(0, braceIdx).replace(/\s+$/, '')
        if (!before) continue
        const tokenStart = findNotifyTokenStart(before)
        if (tokenStart < 0) continue
        // Reject whitespace-delimited mentions (`Example: AGENT_NOTIFY_SUMMARY ...`).
        const prefix = before.slice(0, tokenStart)
        if (prefix.trim().length > 0 && /\s/.test(before[tokenStart - 1]!)) continue
        const jsonPart = trimmedEnd.slice(braceIdx).trim()
        if (!jsonPart.startsWith('{') || !jsonPart.endsWith('}')) continue
        try {
            if (isObject(JSON.parse(jsonPart))) {
                matched = { jsonPart, start: tokenStart }
            }
        } catch {
            // Try an earlier `{` (e.g. nested braces / truncated payload).
        }
    }
    return matched
}

function parseNotifySummaryJson(jsonPart: string): NotifySummary | null {
    try {
        const parsed: unknown = JSON.parse(jsonPart)
        if (!isObject(parsed)) return null
        const result: NotifySummary = {}
        if (typeof parsed.version === 'number') result.version = parsed.version
        if (typeof parsed.agent === 'string') result.agent = parsed.agent
        if (typeof parsed.project === 'string') result.project = parsed.project
        if (typeof parsed.status === 'string') result.status = parsed.status
        if (typeof parsed.action === 'string') result.action = parsed.action
        if (typeof parsed.summary === 'string') result.summary = parsed.summary
        return result
    } catch {
        return null
    }
}

type NotifySummaryMatch = {
    lines: string[]
    lastIdx: number
    line: string
    match: NotifySummaryLineMatch
    summary: NotifySummary
}

function findNotifySummary(text: string): NotifySummaryMatch | null {
    const lines = text.split('\n')
    let lastIdx = lines.length - 1
    while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx -= 1
    if (lastIdx < 0) return null

    const line = lines[lastIdx].trimEnd()
    const match = matchNotifySummaryLine(line)
    if (match === null) return null

    const summary = parseNotifySummaryJson(match.jsonPart)
    if (summary === null) return null

    return { lines, lastIdx, line, match, summary }
}

/**
 * Look for an `AGENT_NOTIFY_SUMMARY {...json...}` footer as the **last
 * non-empty line** of an agent's plain-text message.
 */
export function extractNotifySummary(text: unknown): NotifySummary | null {
    if (typeof text !== 'string' || text.length === 0) return null

    return findNotifySummary(text)?.summary ?? null
}

export type NotifySummaryDisplay = {
    /** Agent prose with the machine-readable footer removed. */
    visibleText: string
    summary: NotifySummary
}

export function splitNotifySummary(text: unknown): NotifySummaryDisplay | null {
    if (typeof text !== 'string' || text.length === 0) return null

    const found = findNotifySummary(text)
    if (found === null) return null

    const prefix = found.line.slice(0, found.match.start).trimEnd()
    const visibleLines = found.lines.slice(0, found.lastIdx)
    if (prefix.length > 0) visibleLines.push(prefix)

    return {
        visibleText: visibleLines.join('\n').trimEnd(),
        summary: found.summary
    }
}

export function stripNotifySummaryFooter(text: string): string {
    if (typeof text !== 'string' || text.length === 0) return text
    return splitNotifySummary(text)?.visibleText ?? text
}

export type { RoleWrappedRecord }
