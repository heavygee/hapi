/**
 * Server-side write authorization for Overseer converse.
 *
 * Capability is hub-owned conversational focus (structured session and/or inbox
 * item), not regex matching of the latest utterance. The old RELAY_INTENT /
 * pronoun / line-local id extractors were debt — they made "tell it to go ahead"
 * fail and faked understanding with pattern matching.
 *
 * Authorization:
 *  - `allowWrites: true` (admin / voice confirm) → write tools unlocked
 *  - else a non-empty hub focus → write tools unlocked, bound to that focus
 *  - else writes denied
 *
 * Injection defense: tool-originated prose cannot set or retarget focus (see
 * overseerConverseFocus). Write calls must bind to the hub focus when the
 * explicit client flag is off.
 */

import { isOverseerWriteTool, type OverseerWriteToolName } from './overseerEntity'
import type { OverseerConverseFocus } from './overseerConverseFocus'

export type OverseerWriteAuthorization = {
    allowed: ReadonlySet<OverseerWriteToolName>
    /** True when the client sent allowWrites: true (admin console / voice confirm). */
    explicitClientFlag: boolean
    sessionIdPrefixes: readonly string[]
    itemIds: readonly number[]
    /** Quoted snippets from the operator line that a relay message should match (allowWrites only). */
    messageSnippets: readonly string[]
}

function extractQuotedSnippets(text: string): string[] {
    const out: string[] = []
    for (const match of text.matchAll(/"([^"]{1,500})"|'([^']{1,500})'/g)) {
        const value = (match[1] ?? match[2] ?? '').trim()
        if (value && !out.includes(value)) out.push(value)
    }
    return out
}

function focusTargets(focus: OverseerConverseFocus | null | undefined): {
    sessionIdPrefixes: string[]
    itemIds: number[]
} {
    const sessionIdPrefixes: string[] = []
    const itemIds: number[] = []
    if (!focus) return { sessionIdPrefixes, itemIds }
    if (focus.sessionId?.trim()) sessionIdPrefixes.push(focus.sessionId.trim().toLowerCase())
    if (focus.itemId != null && focus.itemId > 0) itemIds.push(focus.itemId)
    return { sessionIdPrefixes, itemIds }
}

function hasFocusSubject(focus: OverseerConverseFocus | null | undefined): boolean {
    const t = focusTargets(focus)
    return t.sessionIdPrefixes.length > 0 || t.itemIds.length > 0
}

/**
 * Resolve write authorization from hub focus and/or explicit client flag.
 * Does not pattern-match operator NL for intent or targets.
 */
export function resolveOverseerWriteAuthorization(opts: {
    latestOperatorText?: string
    allowWrites?: boolean
    /** Hub-owned subject from successful tool resolves (required for converse writes). */
    focus?: OverseerConverseFocus | null
}): OverseerWriteAuthorization {
    const text = opts.latestOperatorText ?? ''
    const targets = focusTargets(opts.focus)

    if (opts.allowWrites === true) {
        return {
            allowed: new Set<OverseerWriteToolName>(['ping_session', 'record_disposition']),
            explicitClientFlag: true,
            sessionIdPrefixes: targets.sessionIdPrefixes,
            itemIds: targets.itemIds,
            messageSnippets: extractQuotedSnippets(text)
        }
    }

    if (hasFocusSubject(opts.focus)) {
        return {
            allowed: new Set<OverseerWriteToolName>(['ping_session', 'record_disposition']),
            explicitClientFlag: false,
            sessionIdPrefixes: targets.sessionIdPrefixes,
            itemIds: targets.itemIds,
            messageSnippets: []
        }
    }

    return {
        allowed: new Set<OverseerWriteToolName>(),
        explicitClientFlag: false,
        sessionIdPrefixes: [],
        itemIds: [],
        messageSnippets: []
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
 * Per-call authorization: tool class must be allowed, and (unless explicitClientFlag)
 * the call args must bind to hub focus.
 */
export function isWriteToolCallAuthorized(
    tool: string,
    args: Record<string, unknown>,
    auth: OverseerWriteAuthorization
): { ok: true } | { ok: false; error: string } {
    if (!isOverseerWriteTool(tool)) return { ok: true }
    if (!auth.allowed.has(tool)) {
        return {
            ok: false,
            error: 'write not authorized (no conversational focus and no allowWrites)'
        }
    }

    if (tool === 'ping_session') {
        const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
        const itemId = typeof args.itemId === 'number' ? args.itemId : null
        const message = typeof args.message === 'string' ? args.message : ''

        if (auth.explicitClientFlag) {
            if (!messageMatchesGrant(message, auth.messageSnippets)) {
                return { ok: false, error: 'relay message does not match operator-quoted payload' }
            }
            // Optional soft bind: when focus exists under allowWrites, still prefer it,
            // but allowWrites alone may target any session (admin confirm path).
            return { ok: true }
        }

        const hasTargetGrant = auth.sessionIdPrefixes.length > 0 || auth.itemIds.length > 0
        if (!hasTargetGrant) {
            return {
                ok: false,
                error: 'relay requires conversational focus (session and/or inbox item) or allowWrites'
            }
        }
        const sessionOk = sessionId.length > 0 && sessionIdMatchesGrant(sessionId, auth.sessionIdPrefixes)
        const itemOk = itemId != null && auth.itemIds.includes(itemId)
        if (!sessionOk && !itemOk) {
            return { ok: false, error: 'relay target does not match conversational focus' }
        }
        return { ok: true }
    }

    if (tool === 'record_disposition') {
        const itemId = typeof args.itemId === 'number' ? args.itemId : null
        if (auth.explicitClientFlag) return { ok: true }
        if (auth.itemIds.length === 0) {
            return {
                ok: false,
                error: 'disposition requires focused inbox item (or allowWrites)'
            }
        }
        if (itemId == null || !auth.itemIds.includes(itemId)) {
            return { ok: false, error: 'disposition itemId does not match conversational focus' }
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
