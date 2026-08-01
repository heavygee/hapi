/**
 * Server-side write authorization for Overseer converse.
 *
 * Write tools must not run merely because the model asked — untrusted tool
 * results (inbox titles, worker output) are fed back as `user` messages and can
 * prompt-inject a relay/disposition. Authorization comes from the operator's
 * latest utterance and/or an explicit client `allowWrites` flag — never from
 * model-selected tools alone.
 *
 * Grants are bound to extracted targets/payloads when present so a later
 * injected tool call cannot retarget a legitimate "ping session X" grant.
 */

import { isOverseerWriteTool, type OverseerWriteToolName } from './overseerEntity'

export type OverseerWriteAuthorization = {
    allowed: ReadonlySet<OverseerWriteToolName>
    /** True when the client sent allowWrites: true (admin console / voice confirm). */
    explicitClientFlag: boolean
    sessionIdPrefixes: readonly string[]
    itemIds: readonly number[]
    /** Quoted snippets from the operator line that a relay message should match. */
    messageSnippets: readonly string[]
}

const RELAY_INTENT =
    /\b(ping|relay|nudge|wake)\b|\btell\b[\s\S]{0,80}\b(session|worker|peer|agent|him|her|them|it)\b|\b(message|ask|send)\b[\s\S]{0,80}\b(session|worker|peer|agent)\b/i

const DISPOSITION_INTENT =
    /\b(snooze|dismiss|reopen|dispose)\b|\bmark\b[\s\S]{0,40}\bdone\b|\b(resolve|done with)\b/i

/** UUID or hex-prefix session ids (production hub shape). */
const UUID_OR_HEX_SESSION_RE =
    /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{8,})\b/gi
/** Explicit `session <token>` form — covers short test ids like `sess-1` / `old-id`. */
const NAMED_SESSION_RE = /\bsession\s+([a-z0-9][a-z0-9_-]{1,63})\b/gi
const ITEM_ID_RE = /\b(?:item\s*#?|#)(\d+)\b/gi

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

function extractItemIds(text: string): number[] {
    const out: number[] = []
    for (const match of text.matchAll(ITEM_ID_RE)) {
        const id = Number(match[1])
        if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id)
    }
    return out
}

function extractQuotedSnippets(text: string): string[] {
    const out: string[] = []
    for (const match of text.matchAll(/"([^"]{1,500})"|'([^']{1,500})'/g)) {
        const value = (match[1] ?? match[2] ?? '').trim()
        if (value && !out.includes(value)) out.push(value)
    }
    return out
}

/** Detect which write classes the latest operator message authorizes. */
export function detectOperatorWriteTools(operatorText: string): Set<OverseerWriteToolName> {
    const allowed = new Set<OverseerWriteToolName>()
    const text = operatorText.trim()
    if (!text) return allowed
    if (RELAY_INTENT.test(text)) allowed.add('ping_session')
    if (DISPOSITION_INTENT.test(text)) allowed.add('record_disposition')
    return allowed
}

export function resolveOverseerWriteAuthorization(opts: {
    latestOperatorText: string
    allowWrites?: boolean
}): OverseerWriteAuthorization {
    const text = opts.latestOperatorText
    if (opts.allowWrites === true) {
        return {
            allowed: new Set<OverseerWriteToolName>(['ping_session', 'record_disposition']),
            explicitClientFlag: true,
            sessionIdPrefixes: extractSessionIdPrefixes(text),
            itemIds: extractItemIds(text),
            messageSnippets: extractQuotedSnippets(text)
        }
    }
    return {
        allowed: detectOperatorWriteTools(text),
        explicitClientFlag: false,
        sessionIdPrefixes: extractSessionIdPrefixes(text),
        itemIds: extractItemIds(text),
        messageSnippets: extractQuotedSnippets(text)
    }
}

function sessionIdMatchesGrant(sessionId: string, prefixes: readonly string[]): boolean {
    const lower = sessionId.trim().toLowerCase()
    return prefixes.some((prefix) => lower === prefix || lower.startsWith(prefix))
}

function messageMatchesGrant(message: string, snippets: readonly string[]): boolean {
    if (snippets.length === 0) return true
    return snippets.some((snippet) => message.includes(snippet))
}

/**
 * Per-call authorization: tool class must be allowed, and when the operator
 * named a target, the call args must bind to it (unless explicitClientFlag).
 */
export function isWriteToolCallAuthorized(
    tool: string,
    args: Record<string, unknown>,
    auth: OverseerWriteAuthorization
): { ok: true } | { ok: false; error: string } {
    if (!isOverseerWriteTool(tool)) return { ok: true }
    if (!auth.allowed.has(tool)) {
        return { ok: false, error: 'write not authorized by operator message (no explicit write intent)' }
    }

    if (tool === 'ping_session') {
        const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
        const itemId = typeof args.itemId === 'number' ? args.itemId : null
        const message = typeof args.message === 'string' ? args.message : ''

        if (auth.explicitClientFlag) {
            if (!messageMatchesGrant(message, auth.messageSnippets)) {
                return { ok: false, error: 'relay message does not match operator-quoted payload' }
            }
            return { ok: true }
        }

        const hasTargetGrant = auth.sessionIdPrefixes.length > 0 || auth.itemIds.length > 0
        if (!hasTargetGrant) {
            return {
                ok: false,
                error: 'relay requires an explicit session id / item id in the operator message (or allowWrites)'
            }
        }
        const sessionOk = sessionId.length > 0 && sessionIdMatchesGrant(sessionId, auth.sessionIdPrefixes)
        const itemOk = itemId != null && auth.itemIds.includes(itemId)
        if (!sessionOk && !itemOk) {
            return { ok: false, error: 'relay target does not match operator-authorized session/item' }
        }
        if (!messageMatchesGrant(message, auth.messageSnippets)) {
            return { ok: false, error: 'relay message does not match operator-quoted payload' }
        }
        return { ok: true }
    }

    if (tool === 'record_disposition') {
        const itemId = typeof args.itemId === 'number' ? args.itemId : null
        if (auth.explicitClientFlag) return { ok: true }
        if (auth.itemIds.length === 0) {
            return {
                ok: false,
                error: 'disposition requires an explicit item id in the operator message (or allowWrites)'
            }
        }
        if (itemId == null || !auth.itemIds.includes(itemId)) {
            return { ok: false, error: 'disposition itemId does not match operator-authorized item' }
        }
        return { ok: true }
    }

    return { ok: true }
}

/** @deprecated Prefer isWriteToolCallAuthorized — class-only check is insufficient. */
export function isWriteToolAuthorized(
    tool: string,
    auth: OverseerWriteAuthorization
): boolean {
    if (!isOverseerWriteTool(tool)) return true
    return auth.allowed.has(tool)
}

export function fingerprintWriteToolCall(tool: string, args: Record<string, unknown>): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort())
    return `${tool}:${normalized}`
}
