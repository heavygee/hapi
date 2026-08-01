export const INBOX_ITEM_STATUSES = [
    'new',
    'surfaced',
    'deferred',
    'snoozed',
    'resolved',
    'obsoleted',
    'held'
] as const

export type InboxItemStatus = typeof INBOX_ITEM_STATUSES[number]

export const INBOX_OPERATOR_ACTIONS = [
    'open',
    'snooze',
    'done',
    'dismiss',
    'route',
    'retry'
] as const

export type InboxOperatorAction = typeof INBOX_OPERATOR_ACTIONS[number]

/**
 * Subset of inbox operator actions exposed to Overseer disposition tools.
 * `route` and `retry` are inbox-UI actions only — the brain must not emit them
 * via `record_disposition` (they would map to `surfaced` without doing the work).
 */
export const OVERSEER_DISPOSITION_ACTIONS = ['done', 'dismiss', 'snooze', 'open'] as const

export type OverseerDispositionAction = typeof OVERSEER_DISPOSITION_ACTIONS[number]

/**
 * The disposition predicate vocabulary (R8): the snapshot columns frozen on each disposition row
 * ARE the standing-order match keys AND the discovery `GROUP BY` keys — one shared vocabulary.
 * `query_dispositions` filters and clusters on exactly these columns.
 */
export const DISPOSITION_PREDICATE_COLUMNS = [
    'action',
    'source_kind',
    'source_ref',
    'event_type',
    'category',
    'project',
    'artifact_kind',
    'repo'
] as const

export type DispositionPredicateColumn = typeof DISPOSITION_PREDICATE_COLUMNS[number]

export const INBOX_CATEGORIES = [
    'APPROVAL',
    'BLOCKED',
    'QUESTION',
    'REVIEW',
    'ERROR',
    'FINALE',
    'STALE'
] as const

export type InboxCategory = typeof INBOX_CATEGORIES[number]

export type ArtifactRef = {
    kind?: string
    url?: string
    title?: string
    ref?: string
}

const TITLE_PRIORITY_KINDS = [
    'github_pr',
    'github_issue',
    'branch',
    'commit',
    'deploy_id'
] as const

/** Fixed coarse rank — lower number = higher priority (v1, not learned). */
export function computeCoarseBasePriority(eventType: string): number {
    switch (eventType) {
        case 'approval_requested':
        case 'permission_request':
            return 10
        case 'blocked':
            return 20
        case 'needs_decision':
            return 30
        case 'failed':
            return 35
        case 'needs_review':
            return 40
        case 'completed':
            return 50
        case 'stale':
            return 60
        default:
            return 70
    }
}

export function mapEventTypeToInboxCategory(eventType: string): InboxCategory {
    switch (eventType) {
        case 'approval_requested':
        case 'permission_request':
            return 'APPROVAL'
        case 'blocked':
            return 'BLOCKED'
        case 'needs_decision':
            return 'QUESTION'
        case 'needs_review':
            return 'REVIEW'
        case 'failed':
            return 'ERROR'
        case 'completed':
            return 'FINALE'
        case 'stale':
            return 'STALE'
        default:
            return 'QUESTION'
    }
}

export function parseArtifactRefs(raw: string | null | undefined): ArtifactRef[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.filter((entry): entry is ArtifactRef => typeof entry === 'object' && entry !== null)
    } catch {
        return []
    }
}

export function pickPrimaryArtifact(artifactRefs: ArtifactRef[]): ArtifactRef | null {
    for (const kind of TITLE_PRIORITY_KINDS) {
        const match = artifactRefs.find((ref) => ref.kind === kind)
        if (match) return match
    }
    return artifactRefs[0] ?? null
}

export function pickPrimaryArtifactTitle(artifactRefs: ArtifactRef[]): string | null {
    const match = pickPrimaryArtifact(artifactRefs)
    if (!match) return null
    if (match.title?.trim()) return match.title.trim()
    if (match.ref?.trim()) return match.ref.trim()
    if (match.url?.trim()) return match.url.trim()
    return null
}

export function buildInboxTitle(
    artifactRefsJson: string | null | undefined,
    sessionName: string | null | undefined,
    summary: string
): string {
    const artifactTitle = pickPrimaryArtifactTitle(parseArtifactRefs(artifactRefsJson))
    if (artifactTitle) return artifactTitle
    const sessionLabel = sessionName?.trim()
    if (sessionLabel) return sessionLabel
    const trimmed = summary.trim()
    return trimmed.length > 0 ? trimmed.slice(0, 120) : 'Attention item'
}

/** Read denormalized session.name from event payload (#22) — no live sessions lookup. */
export function extractDenormalizedSessionName(payloadJson: string | null | undefined): string | null {
    if (!payloadJson) return null
    try {
        const payload = JSON.parse(payloadJson) as { session?: { name?: unknown } }
        const name = payload.session?.name
        return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
    } catch {
        return null
    }
}

export function buildInboxTitleFromEvent(
    artifactRefsJson: string | null | undefined,
    payloadJson: string | null | undefined,
    summary: string
): string {
    return buildInboxTitle(artifactRefsJson, extractDenormalizedSessionName(payloadJson), summary)
}

export function formatAgeMinutes(ageMs: number): string {
    const minutes = Math.max(1, Math.round(ageMs / 60_000))
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h`
    const days = Math.round(hours / 24)
    return `${days}d`
}

export function buildExplainPriority(
    category: string,
    createdAt: number,
    sourceEventIds: number[],
    now: number = Date.now()
): string {
    const age = formatAgeMinutes(now - createdAt)
    const eventLabel = sourceEventIds.length === 1
        ? `event #${sourceEventIds[0]}`
        : `${sourceEventIds.length} events (#${sourceEventIds.slice(0, 3).join(', ')}${sourceEventIds.length > 3 ? ', …' : ''})`
    return `${category} tier · queued ${age} ago · from ${eventLabel}`
}

export function mapOperatorActionToStatus(action: InboxOperatorAction): InboxItemStatus {
    switch (action) {
        case 'open':
            return 'surfaced'
        case 'snooze':
            return 'snoozed'
        case 'done':
            return 'resolved'
        case 'dismiss':
            return 'obsoleted'
        case 'route':
        case 'retry':
            return 'surfaced'
        default:
            return 'surfaced'
    }
}

export function isActiveInboxStatus(status: string): boolean {
    return status === 'new' || status === 'surfaced' || status === 'deferred' || status === 'snoozed'
}
