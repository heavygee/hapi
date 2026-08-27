/**
 * Allow-list + session filter from heavygee/hapi-inline v0.10.0
 * (`lib/operator-mic.ts` parseOperatorMicPath / filterOperatorSessions).
 * Host wiring only — do not widen this list. Raw GET /api/sessions is forbidden.
 * POST abort is required for replies composer (#169 / v0.12.0); GET abort is not.
 * Hub POST /api/stt is JWT/Dictate, not this gate-secret proxy.
 */
import { timingSafeEqual } from 'node:crypto'

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

export type AllowedSessionAction = 'messages' | 'upload' | 'abort'

export type OperatorSessionListItem = {
    id: string
    name: string
    active: boolean
    updatedAt: number
    flavor: string | null
    unread: boolean
}

export type ParsedOperatorMicPath =
    | {
        kind: 'session-action'
        method: 'GET' | 'POST'
        sessionId: string
        action: AllowedSessionAction
        pathname: string
        search: string
        pathWithQuery: string
    }
    | {
        kind: 'operator-sessions'
        method: 'GET' | 'POST'
        pathname: '/operator/sessions'
        search: string
        pathWithQuery: string
    }

function parsePathAndQuery(pathWithOptionalQuery: string): { path: string, query: string } {
    const q = pathWithOptionalQuery.indexOf('?')
    if (q === -1) return { path: pathWithOptionalQuery, query: '' }
    return { path: pathWithOptionalQuery.slice(0, q), query: pathWithOptionalQuery.slice(q + 1) }
}

function rejectSuspiciousSessionId(sessionId: string): boolean {
    if (!SESSION_ID_RE.test(sessionId)) return true
    if (sessionId.includes('.') || sessionId === '.' || sessionId === '..') return true
    if (/[%\\#?]/.test(sessionId)) return true
    return false
}

export function parseOperatorMicPath(
    method: string,
    pathWithOptionalQuery: string
): ParsedOperatorMicPath | null {
    const upper = method.toUpperCase()
    if (upper !== 'GET' && upper !== 'POST') return null
    if (!pathWithOptionalQuery || !pathWithOptionalQuery.startsWith('/')) return null
    if (pathWithOptionalQuery.includes('\\') || pathWithOptionalQuery.includes('#')) return null

    const { path, query } = parsePathAndQuery(pathWithOptionalQuery)
    const segments = path.split('/')
    const search = query ? `?${query}` : ''

    if (segments.length === 3 && segments[1] === 'operator' && segments[2] === 'sessions') {
        return {
            kind: 'operator-sessions',
            method: upper,
            pathname: '/operator/sessions',
            search,
            pathWithQuery: `/operator/sessions${search}`
        }
    }

    if (segments.length !== 5) return null
    if (segments[1] !== 'api' || segments[2] !== 'sessions') return null

    const sessionId = segments[3] ?? ''
    const action = segments[4] as AllowedSessionAction
    if (!sessionId || rejectSuspiciousSessionId(sessionId)) return null
    if (action !== 'messages' && action !== 'upload' && action !== 'abort') return null
    if (upper === 'GET' && action !== 'messages') return null
    if (upper === 'POST' && action !== 'messages' && action !== 'upload' && action !== 'abort') return null

    const pathname = `/api/sessions/${sessionId}/${action}`
    return {
        kind: 'session-action',
        method: upper,
        sessionId,
        action,
        pathname,
        search,
        pathWithQuery: `${pathname}${search}`
    }
}

export function isOperatorMicPathAllowed(method: string, pathWithOptionalQuery: string): boolean {
    return parseOperatorMicPath(method, pathWithOptionalQuery) !== null
}

export function normalizeFsPath(value: string): string {
    return String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
}

export function isPathUnderProject(sessionPath: string, projectPath: string): boolean {
    const session = normalizeFsPath(sessionPath)
    const project = normalizeFsPath(projectPath)
    if (!session || !project) return false
    return session === project || session.startsWith(`${project}/`)
}

type HubSessionLike = {
    id?: unknown
    active?: unknown
    updatedAt?: unknown
    pendingRequestsCount?: unknown
    metadata?: {
        name?: unknown
        path?: unknown
        flavor?: unknown
        summary?: { text?: unknown } | null
    } | null
    name?: unknown
}

/** Match web/src/lib/sessionTitle.ts — never prefer full UUID as the operator title. */
export function operatorSessionDisplayName(session: HubSessionLike, id: string): string {
    const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : null
    const named = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
    if (named) return named
    const summary = meta && meta.summary && typeof meta.summary === 'object'
        ? (typeof meta.summary.text === 'string' ? meta.summary.text.trim() : '')
        : ''
    if (summary) return summary
    const path = meta && typeof meta.path === 'string' ? meta.path : ''
    const parts = normalizeFsPath(path).split('/').filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
    return id.slice(0, 8)
}

export function toOperatorSessionListItem(session: HubSessionLike): OperatorSessionListItem | null {
    const id = typeof session.id === 'string' ? session.id : ''
    if (!id) return null
    const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : null
    const flavorRaw = meta && typeof meta.flavor === 'string' ? meta.flavor : null
    const unread = typeof session.pendingRequestsCount === 'number' && session.pendingRequestsCount > 0
    return {
        id,
        name: operatorSessionDisplayName(session, id),
        active: session.active === true,
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
        flavor: flavorRaw,
        unread
    }
}

export function filterOperatorSessions(
    sessions: HubSessionLike[],
    projectPath: string
): OperatorSessionListItem[] {
    const project = normalizeFsPath(projectPath)
    if (!project) return []
    const out: OperatorSessionListItem[] = []
    for (const session of sessions) {
        const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : null
        const path = meta && typeof meta.path === 'string' ? meta.path : ''
        if (!isPathUnderProject(path, project)) continue
        const item = toOperatorSessionListItem(session)
        if (item) out.push(item)
    }
    return out
}

function normalizeHeaderValue(value: string | null | undefined): string {
    return (value ?? '').trim()
}

export function hasConflictingSecretHeaders(
    primaryHeader: string | null | undefined,
    legacyHeader: string | null | undefined
): boolean {
    const primary = normalizeHeaderValue(primaryHeader)
    const legacy = normalizeHeaderValue(legacyHeader)
    return Boolean(primary && legacy && primary !== legacy)
}

export function resolveSecretHeaderValue(
    primaryHeader: string | null | undefined,
    legacyHeader: string | null | undefined
): string {
    const primary = normalizeHeaderValue(primaryHeader)
    const legacy = normalizeHeaderValue(legacyHeader)
    if (hasConflictingSecretHeaders(primaryHeader, legacyHeader)) return ''
    return primary || legacy || ''
}

function timingSafeSecretEqual(expected: string, provided: string): boolean {
    const a = Buffer.from(expected)
    const b = Buffer.from(provided)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

/** JSON body `secret` / `hapiInlineSecret` for Quest Settings probe (headers still win when present). */
export function jsonBodySecret(body: unknown): string {
    if (!body || typeof body !== 'object') return ''
    const rec = body as Record<string, unknown>
    if (typeof rec.secret === 'string' && rec.secret.trim()) return rec.secret.trim()
    if (typeof rec.hapiInlineSecret === 'string' && rec.hapiInlineSecret.trim()) return rec.hapiInlineSecret.trim()
    return ''
}

export function operatorMicSecretMatches(
    expected: string,
    primaryHeader: string | null | undefined,
    legacyHeader?: string | null | undefined,
    bodySecret?: string | null | undefined
): boolean {
    if (!expected) return false
    if (hasConflictingSecretHeaders(primaryHeader, legacyHeader)) return false
    const fromHeaders = resolveSecretHeaderValue(primaryHeader, legacyHeader)
    const fromBody = normalizeHeaderValue(bodySecret)
    if (fromHeaders && fromBody && fromHeaders !== fromBody) return false
    const provided = fromHeaders || fromBody
    if (!provided) return false
    return timingSafeSecretEqual(expected, provided)
}
