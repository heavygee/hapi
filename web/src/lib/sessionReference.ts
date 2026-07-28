export function buildSessionReferencePath(sessionId: string): string {
    const base = import.meta.env.BASE_URL ?? '/'
    const normalizedBase = base.endsWith('/') ? base : `${base}/`
    return `${normalizedBase}sessions/${encodeURIComponent(sessionId)}`.replace(/\/{2,}/g, '/')
}

function sanitizeSessionReferenceTitle(sessionTitle: string): string {
    return sessionTitle.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** Clipboard text for citing this session in another HAPI chat (not a public share link). */
export function buildSessionReferenceText(sessionTitle: string, sessionId: string): string {
    const path = buildSessionReferencePath(sessionId)
    const title = sanitizeSessionReferenceTitle(sessionTitle)
    if (title) {
        return `See session ${JSON.stringify(title)} (${path}) for context`
    }
    return `See HAPI session ${path} for context`
}

/** Minimal session shape for @-mention ranking (avoids coupling to full SessionSummary). */
export type SessionMentionCandidate = {
    id: string
    title: string
    active: boolean
    updatedAt: number
    /** When `archived`, deprioritized unless the query matches. */
    lifecycleState?: string | null
}

export type MatchSessionsForMentionOptions = {
    excludeId?: string
    limit?: number
}

function normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim().toLowerCase()
}

function scoreSession(session: SessionMentionCandidate, query: string): number | null {
    if (!query) {
        // Empty / whitespace query: shortlist only — active first, then recent.
        // Archived stay searchable once the user types.
        if (session.lifecycleState === 'archived') return null
        return session.active ? 1_000_000_000 + session.updatedAt : session.updatedAt
    }

    const title = session.title.toLowerCase()
    const id = session.id.toLowerCase()
    const idPrefix = id.slice(0, 8)

    let score = 0
    if (title === query) score = 500
    else if (title.startsWith(query)) score = 400
    else if (title.includes(query)) score = 300
    else if (idPrefix.startsWith(query) || id.startsWith(query)) score = 200
    else if (id.includes(query)) score = 100
    else return null

    if (session.active) score += 50
    if (session.lifecycleState === 'archived') score -= 25
    // Prefer recently updated among equal textual matches.
    return score * 1e13 + session.updatedAt
}

/**
 * Rank sessions for composer `@` autocomplete.
 * Empty query → active/recent shortlist (excludes archived).
 * Non-empty → fuzzy match on title + id prefix across all candidates including archived.
 */
export function matchSessionsForMention(
    sessions: readonly SessionMentionCandidate[],
    query: string,
    options: MatchSessionsForMentionOptions = {}
): SessionMentionCandidate[] {
    const limit = options.limit ?? 20
    const excludeId = options.excludeId
    const normalized = normalizeQuery(query)

    const scored: { session: SessionMentionCandidate; score: number }[] = []
    for (const session of sessions) {
        if (excludeId && session.id === excludeId) continue
        const score = scoreSession(session, normalized)
        if (score === null) continue
        scored.push({ session, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((entry) => entry.session)
}

/** Match in-app session paths produced by buildSessionReferencePath (optional BASE_URL). */
const SESSION_PATH_RE = /^(?:\.?\/)?(?:[\w.-]+\/)*sessions\/([^/?#]+)\/?$/

/** Parse a session id from a relative `/sessions/<id>` (or BASE_URL-prefixed) href. */
export function parseSessionPathHref(href: string): string | null {
    const trimmed = href.trim()
    if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
    const match = SESSION_PATH_RE.exec(trimmed)
    if (!match) return null
    try {
        const id = decodeURIComponent(match[1] ?? '')
        return id.length > 0 ? id : null
    } catch {
        return null
    }
}
