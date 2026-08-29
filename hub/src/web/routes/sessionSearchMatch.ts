/**
 * Keyword match + rank for GET /api/sessions/search (Layer 0 inventory).
 * v1: name, path, agentSessionId, and session id — not message body FTS.
 */

import { toSessionSummaryMetadata } from '@hapi/protocol'
import type { Session } from '../../sync/syncEngine'

export type SessionSearchFields = {
    id: string
    name: string
    path: string
    agentSessionId: string
}

const SCORE_NAME = 400
const SCORE_PATH = 300
const SCORE_AGENT_SESSION_ID = 200
const SCORE_SESSION_ID = 100

export function normalizeSessionSearchQuery(raw: string): string {
    return raw.trim().toLowerCase()
}

export function sessionSearchFields(session: Session): SessionSearchFields {
    const meta = toSessionSummaryMetadata(session.metadata)
    return {
        id: session.id,
        name: (meta?.name ?? '').trim(),
        path: (meta?.path ?? '').trim(),
        agentSessionId: (meta?.agentSessionId ?? '').trim(),
    }
}

function fieldContains(haystack: string, needle: string): boolean {
    return haystack.length > 0 && haystack.toLowerCase().includes(needle)
}

/**
 * Higher is better. Returns 0 when nothing matches.
 * Tie-break callers should use updatedAt after this score.
 */
export function scoreSessionSearchMatch(session: Session, normalizedQuery: string): number {
    if (!normalizedQuery) {
        return 0
    }
    const fields = sessionSearchFields(session)
    let score = 0
    if (fieldContains(fields.name, normalizedQuery)) {
        score = Math.max(score, SCORE_NAME)
    }
    if (fieldContains(fields.path, normalizedQuery)) {
        score = Math.max(score, SCORE_PATH)
    }
    if (fieldContains(fields.agentSessionId, normalizedQuery)) {
        score = Math.max(score, SCORE_AGENT_SESSION_ID)
    }
    if (fieldContains(fields.id, normalizedQuery)) {
        score = Math.max(score, SCORE_SESSION_ID)
    }
    return score
}
