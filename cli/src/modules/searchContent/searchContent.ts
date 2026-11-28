/**
 * Session-credentialed fleet content search (MCP `search_content`).
 *
 * Wraps GET/POST `/api/sessions/content-search` using the same CLI_API_TOKEN →
 * JWT exchange as `search_peers` / `ping_peer`. Never treats auth or backend
 * failure as an empty match list — that failure mode produced false negatives
 * for Overseer stand-in work (expired hand-minted JWT → `[]` looked like
 * "no matches").
 */

import axios, { type AxiosInstance } from 'axios'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'

export type SearchContentErrorCode =
    | 'bad_args'
    | 'auth_failed'
    | 'backend_failed'
    | 'unavailable'

export class SearchContentError extends Error {
    readonly code: SearchContentErrorCode

    constructor(code: SearchContentErrorCode, message: string) {
        super(message)
        this.name = 'SearchContentError'
        this.code = code
    }
}

export type SearchContentMatch = {
    sessionId: string
    name: string | null
    path: string | null
    flavor: string | null
    agentSessionId: string | null
    messageId: string
    role: string
    seq: number
    createdAt: number
    snippet: string
}

export type SearchContentResult = {
    matches: SearchContentMatch[]
    /** Hub-reported match count when present; otherwise matches.length. */
    total: number
}

export type SearchContentOptions = {
    query: string
    /** Optional single-session scope (hub `sessionId` query / body). */
    sessionId?: string
    /** Optional multi-session scope. */
    sessionIds?: string[]
    limit?: number
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
}

const AUTH_RECOVERY_HINT =
    'On a remote runner, set HAPI_API_URL to the runner hub, and set CLI_API_TOKEN ' +
    'or run `hapi auth login` to save the token. Inside a HAPI session prefer MCP ' +
    '`search_content`, which uses the session CLI credentials — never hand-mint a JWT.'

const TRIGRAM_HINT =
    'Query tip: short/common substrings match badly via trigram FTS ' +
    '(e.g. "Ian" hits Austral**ian**; "home" hits every /home/ path). Prefer distinctive nouns.'

function resolveApiUrl(apiUrl?: string): string {
    const raw = (apiUrl ?? configuration.apiUrl).trim().replace(/\/+$/, '')
    if (!raw) {
        throw new SearchContentError(
            'bad_args',
            `HAPI API URL is empty. ${AUTH_RECOVERY_HINT}`
        )
    }
    return raw
}

function resolveAccessToken(accessToken?: string): string {
    let token = ''
    try {
        token = (accessToken ?? getAuthToken()).trim()
    } catch {
        token = (accessToken ?? '').trim()
    }
    if (!token) {
        throw new SearchContentError(
            'bad_args',
            `CLI_API_TOKEN is required (run \`hapi auth login\`). ${AUTH_RECOVERY_HINT}`
        )
    }
    return token
}

function authFailedMessage(apiUrl: string, detail: string): string {
    return `failed to exchange access token for JWT (${detail}). Hub URL: ${apiUrl}. ${AUTH_RECOVERY_HINT}`
}

async function exchangeJwt(
    apiUrl: string,
    accessToken: string,
    http: AxiosInstance
): Promise<string> {
    try {
        const response = await http.post(
            `${apiUrl}/api/auth`,
            { accessToken },
            {
                headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
                timeout: 10_000,
                validateStatus: () => true
            }
        )
        const token = typeof response.data?.token === 'string' ? response.data.token : ''
        if (response.status < 200 || response.status >= 300 || !token) {
            const detail = typeof response.data?.error === 'string'
                ? response.data.error
                : `HTTP ${response.status}`
            throw new SearchContentError('auth_failed', authFailedMessage(apiUrl, detail))
        }
        return token
    } catch (error) {
        if (error instanceof SearchContentError) {
            throw error
        }
        throw new SearchContentError(
            'auth_failed',
            authFailedMessage(apiUrl, error instanceof Error ? error.message : String(error))
        )
    }
}

function authHeaders(jwt: string): Record<string, string> {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
    })
}

function classifyHttpFailure(status: number, detail: string, apiUrl: string): SearchContentError {
    if (status === 401 || status === 403) {
        return new SearchContentError(
            'auth_failed',
            `content search auth failed (${detail}). Hub URL: ${apiUrl}. ${AUTH_RECOVERY_HINT}`
        )
    }
    if (status === 404) {
        return new SearchContentError(
            'unavailable',
            `content search endpoint missing (${detail}). Hub URL: ${apiUrl}. ` +
            'This hub build may not include message content search (soup / upstream #1598).'
        )
    }
    return new SearchContentError(
        'backend_failed',
        `content search failed (${detail}). Hub URL: ${apiUrl}.`
    )
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeMatch(row: unknown): SearchContentMatch | null {
    const record = asRecord(row)
    if (!record) return null

    // Hub shape: { session: SessionSummary, match: { messageId, role, seq, createdAt, snippet } }
    const session = asRecord(record.session) ?? record
    const match = asRecord(record.match) ?? record
    const metadata = asRecord(session.metadata)

    const sessionId = readString(session.id) ?? readString(session.sessionId) ?? readString(match.sessionId)
    const messageId = readString(match.messageId) ?? readString(match.id)
    const snippet = readString(match.snippet) ?? readString(match.text)
    if (!sessionId || !messageId || snippet === null) {
        return null
    }

    const createdAt = readNumber(match.createdAt) ?? readNumber(match.ts) ?? 0
    const seq = readNumber(match.seq) ?? 0
    const role = readString(match.role) ?? 'unknown'

    return {
        sessionId,
        name: readString(session.name)
            ?? readString(metadata?.name)
            ?? null,
        path: readString(session.path)
            ?? readString(metadata?.path)
            ?? null,
        flavor: readString(session.flavor)
            ?? readString(metadata?.flavor)
            ?? null,
        agentSessionId: readString(session.agentSessionId)
            ?? readString(metadata?.agentSessionId)
            ?? null,
        messageId,
        role,
        seq,
        createdAt,
        snippet
    }
}

function parseContentSearchBody(body: unknown): SearchContentResult {
    const record = asRecord(body)
    if (!record) {
        throw new SearchContentError(
            'backend_failed',
            'content search returned unexpected response (not an object)'
        )
    }

    // Never accept a bare array as success without envelope — older broken
    // clients treated any 200 body as matches; keep the contract strict.
    const results = Array.isArray(record.results)
        ? record.results
        : Array.isArray(record.matches)
            ? record.matches
            : null

    if (results === null) {
        // Explicit error field from hub
        if (typeof record.error === 'string' && record.error.trim()) {
            throw new SearchContentError('backend_failed', `content search failed: ${record.error}`)
        }
        throw new SearchContentError(
            'backend_failed',
            'content search returned unexpected response (missing results[]). ' +
            'Refusing to treat this as zero matches.'
        )
    }

    const matches = results
        .map((row) => normalizeMatch(row))
        .filter((row): row is SearchContentMatch => row !== null)

    const total = readNumber(record.total) ?? matches.length
    return { matches, total }
}

/**
 * Search transcript text across the fleet (or scoped sessions).
 * Throws SearchContentError on auth/backend failure — never returns [].
 */
export async function searchSessionContent(
    options: SearchContentOptions
): Promise<SearchContentResult> {
    const query = options.query.trim()
    if (!query) {
        throw new SearchContentError('bad_args', `search query is required. ${TRIGRAM_HINT}`)
    }
    if (query.length < 2) {
        throw new SearchContentError(
            'bad_args',
            `query must be at least 2 characters. ${TRIGRAM_HINT}`
        )
    }

    const apiUrl = resolveApiUrl(options.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios
    const jwt = await exchangeJwt(apiUrl, accessToken, http)

    const limitRaw = options.limit ?? 50
    const limit = Math.min(100, Math.max(1, Math.floor(limitRaw)))

    const sessionIds = [
        ...(options.sessionId ? [options.sessionId] : []),
        ...(options.sessionIds ?? [])
    ]
        .map((id) => id.trim())
        .filter(Boolean)
    const uniqueSessionIds = [...new Set(sessionIds)]

    // Prefer POST when scoping many sessions (URL length); GET for simple queries.
    const usePost = uniqueSessionIds.length > 1
    let response
    try {
        if (usePost) {
            response = await http.post(
                `${apiUrl}/api/sessions/content-search`,
                {
                    query: query.slice(0, 200),
                    limit,
                    sessionIds: uniqueSessionIds
                },
                {
                    headers: authHeaders(jwt),
                    timeout: 30_000,
                    validateStatus: () => true
                }
            )
        } else {
            const params: Record<string, string | number> = {
                query: query.slice(0, 200),
                limit
            }
            if (uniqueSessionIds[0]) {
                params.sessionId = uniqueSessionIds[0]
            }
            response = await http.get(
                `${apiUrl}/api/sessions/content-search`,
                {
                    headers: authHeaders(jwt),
                    params,
                    timeout: 30_000,
                    validateStatus: () => true
                }
            )
        }
    } catch (error) {
        throw new SearchContentError(
            'backend_failed',
            `content search transport failed (${error instanceof Error ? error.message : String(error)}). Hub URL: ${apiUrl}.`
        )
    }

    if (response.status < 200 || response.status >= 300) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw classifyHttpFailure(response.status, detail, apiUrl)
    }

    return parseContentSearchBody(response.data)
}

export function formatSearchContentMatches(
    result: SearchContentResult,
    options: { query: string; maxRows?: number } 
): string {
    const maxRows = options.maxRows ?? result.matches.length
    const rows = result.matches.slice(0, maxRows)
    if (rows.length === 0) {
        return (
            `No transcript matches for '${options.query.trim()}'. ` +
            `(This is a real empty result — auth/backend succeeded.) ${TRIGRAM_HINT}`
        )
    }

    const lines = rows.map((match, index) => {
        const label = match.name
            ?? (match.path ? match.path.split('/').filter(Boolean).pop() ?? null : null)
            ?? match.sessionId.slice(0, 8)
        const when = match.createdAt
            ? new Date(match.createdAt).toISOString()
            : '?'
        const snippet = match.snippet.replace(/\s+/g, ' ').slice(0, 160)
        return (
            `${index + 1}. ${label}  id=${match.sessionId.slice(0, 8)}…  ` +
            `${match.role} @ ${when}\n` +
            `   ${snippet}`
        )
    })

    const more = result.total > rows.length
        ? `\n… ${result.total - rows.length} more (raise limit; hub max 100)`
        : ''

    return (
        `Found ${result.total} transcript match(es) for '${options.query.trim()}':\n` +
        lines.join('\n') +
        more +
        `\n\nThen: inspect_peer / ping_peer with a listed session id. ${TRIGRAM_HINT}`
    )
}

export function exitCodeForSearchContentError(error: SearchContentError): number {
    switch (error.code) {
        case 'bad_args':
            return 2
        case 'auth_failed':
            return 3
        case 'unavailable':
            return 4
        case 'backend_failed':
            return 5
        default:
            return 1
    }
}

/** Duck-type across module copies — `instanceof` alone can miss and fall through. */
export function isSearchContentError(error: unknown): error is SearchContentError {
    if (error instanceof SearchContentError) {
        return true
    }
    if (!error || typeof error !== 'object') {
        return false
    }
    const record = error as { name?: unknown; code?: unknown }
    return record.name === 'SearchContentError' && typeof record.code === 'string'
}

/**
 * Fail the process with a non-zero code. Sets exitCode before exit so callers
 * that only observe process.exitCode (or a delayed exit) still see failure.
 */
export function failSearchContent(error: unknown): never {
    if (isSearchContentError(error)) {
        const code = exitCodeForSearchContentError(error)
        process.exitCode = code
        process.exit(code)
    }
    process.exitCode = 1
    process.exit(1)
}

/** Exported for tests — keep parse strict. */
export const _test = {
    parseContentSearchBody,
    normalizeMatch,
    TRIGRAM_HINT,
    isSearchContentError,
    failSearchContent
}
