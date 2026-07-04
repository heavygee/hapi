/**
 * Structural-first classifier for cursor-agent failure signals.
 *
 * Shared between CLI (primary path) and hub (inline-message backstop for
 * stale runner processes that missed detect metadata writes).
 */
export type CursorAgentStreamFailureKind =
    | 'quota_exhausted'
    | 'canceled'
    | 'deadline_exceeded'
    | 'unavailable'
    | 'connection_stalled'
    | 'context_window'
    | 'capacity_exhausted'
    | 'unknown_t_prefix'
    | 'transport_closed'
    | 'rpc_timeout'
    | 'rpc_error'
    | 'agent_crashed'
    | 'rate_limited'
    | 'auth_failed'
    | 'model_not_found'
    | 'unknown_stderr'
    | 'prompt_failed'

export type CursorAgentStreamFailureSource = 'rpc' | 'stderr' | 'text'

export type CursorAgentStreamFailure = {
    kind: CursorAgentStreamFailureKind
    transient: boolean
    raw: string
    source: CursorAgentStreamFailureSource
}

type Pattern = {
    test: (text: string) => boolean
    kind: CursorAgentStreamFailureKind
    transient: boolean
}

const PATTERNS: Pattern[] = [
    {
        test: (t) => /^[ \t]*Error: T: \[resource_exhausted\]/im.test(t)
            || /^[ \t]*Error: RetriableError: \[resource_exhausted\]/im.test(t),
        kind: 'quota_exhausted',
        transient: false
    },
    {
        test: (t) => /^[ \t]*Error: T: \[canceled\]/im.test(t)
            || /^[ \t]*Error: RetriableError: \[canceled\]/im.test(t),
        kind: 'canceled',
        transient: true
    },
    {
        test: (t) => /^[ \t]*Error: T: \[deadline_exceeded\]/im.test(t)
            || /^[ \t]*Error: RetriableError: \[deadline_exceeded\]/im.test(t),
        kind: 'deadline_exceeded',
        transient: true
    },
    {
        test: (t) => /^[ \t]*Error: T: \[unavailable\]/im.test(t)
            || /^[ \t]*Error: RetriableError: \[unavailable\]/im.test(t),
        kind: 'unavailable',
        transient: true
    },
    {
        test: (t) => /^[ \t]*Error: T: Connection stalled/im.test(t)
            || /^[ \t]*Error: RetriableError: Connection stalled/im.test(t),
        kind: 'connection_stalled',
        transient: true
    },
    {
        test: (t) => /^[ \t]*Gemini prompt failed:.*token count exceeds/im.test(t),
        kind: 'context_window',
        transient: false
    },
    {
        test: (t) => /^[ \t]*Gemini prompt failed:.*exhausted your capacity/im.test(t),
        kind: 'capacity_exhausted',
        transient: false
    },
    {
        test: (t) => /^[ \t]*Error: T: WritableIterable/im.test(t)
            || /^[ \t]*Error: RetriableError: WritableIterable/im.test(t),
        kind: 'transport_closed',
        transient: true
    },
    {
        test: (t) => /^[ \t]*Error: T:/im.test(t)
            || /^[ \t]*Error: RetriableError:/im.test(t),
        kind: 'unknown_t_prefix',
        transient: true
    }
]

export function classifyCursorAgentMessage(text: string): CursorAgentStreamFailure | null {
    for (const pattern of PATTERNS) {
        if (pattern.test(text)) {
            return { kind: pattern.kind, transient: pattern.transient, raw: text, source: 'text' }
        }
    }
    return null
}

export function mapAcpStderrToFailure(error: {
    type: 'rate_limit' | 'model_not_found' | 'authentication' | 'quota_exceeded' | 'unknown'
    raw: string
}): CursorAgentStreamFailure {
    switch (error.type) {
        case 'rate_limit':
            return { kind: 'rate_limited', transient: true, raw: error.raw, source: 'stderr' }
        case 'model_not_found':
            return { kind: 'model_not_found', transient: false, raw: error.raw, source: 'stderr' }
        case 'authentication':
            return { kind: 'auth_failed', transient: false, raw: error.raw, source: 'stderr' }
        case 'quota_exceeded':
            return { kind: 'quota_exhausted', transient: false, raw: error.raw, source: 'stderr' }
        case 'unknown':
        default:
            return { kind: 'unknown_stderr', transient: false, raw: error.raw, source: 'stderr' }
    }
}

export function classifyAcpRpcRejection(error: unknown): CursorAgentStreamFailure | null {
    const raw = error instanceof Error ? error.message : String(error)
    const lower = raw.toLowerCase()

    if (lower.includes('aborted') || lower.includes('user cancelled') || lower.includes('user canceled')) {
        return null
    }

    if (
        lower.includes('writableiterable is closed') ||
        lower.includes('acp transport is closed') ||
        lower.includes('acp transport closed') ||
        lower.includes('acp process exited')
    ) {
        return { kind: 'transport_closed', transient: true, raw, source: 'rpc' }
    }

    if (lower.includes('failed to spawn') || lower.includes('epipe') || lower.includes('ecanceled')) {
        return { kind: 'agent_crashed', transient: true, raw, source: 'rpc' }
    }

    if (lower.includes('timed out after') || lower.includes('timeout')) {
        return { kind: 'rpc_timeout', transient: true, raw, source: 'rpc' }
    }

    const textMatch = classifyCursorAgentMessage(raw)
    if (textMatch) {
        return { ...textMatch, source: 'rpc' }
    }

    return { kind: 'prompt_failed', transient: false, raw, source: 'rpc' }
}

const PRIOR_DONE_PREFIXES = ['done', 'all done', 'committed', 'successfully', 'fixed', 'complete']

export function isCompletionClaim(text: string): boolean {
    const lower = text.trim().toLowerCase()
    return PRIOR_DONE_PREFIXES.some((prefix) => lower.startsWith(prefix))
}
