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
    repo?: string
    number?: number
}

const TITLE_PRIORITY_KINDS = [
    'github_pr',
    'github_issue',
    'branch',
    'commit',
    'deploy_id'
] as const

/**
 * External channel notifications (e.g. the GitHub PR watcher) are routine and
 * must never outrank genuine worker/system attention items. Demoting the whole
 * channel band below the worker/system band (which maxes at 70) keeps a flood
 * of upstream PR notifications from dominating triage.
 */
export const CHANNEL_PRIORITY_OFFSET = 100

function coarseRankForEventType(eventType: string): number {
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
        case 'progress':
            return 65
        default:
            return 70
    }
}

/**
 * Fixed coarse rank — lower number = higher priority (v1, not learned).
 * `sourceKind === 'channel'` items (external GitHub/PR notifications) are
 * demoted below every worker/system item via {@link CHANNEL_PRIORITY_OFFSET},
 * so genuine operator items (blocked workers, needs_decision, failures) always
 * rank above routine PR notifications while preserving order within each band.
 */
export function computeCoarseBasePriority(eventType: string, sourceKind?: string | null): number {
    const rank = coarseRankForEventType(eventType)
    return sourceKind === 'channel' ? rank + CHANNEL_PRIORITY_OFFSET : rank
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

const GITHUB_REF_URL_RE = /github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/(\d+)/i

/** "owner/repo#123" from a GitHub PR/issue URL, else null. */
export function parseGithubRefFromUrl(url: string | null | undefined): string | null {
    if (!url) return null
    const match = GITHUB_REF_URL_RE.exec(url)
    if (!match) return null
    return `${match[1]}/${match[2]}#${match[3]}`
}

/** Compact human ref for an artifact ("owner/repo#123"), never a bare URL. */
function shortRepoRef(ref: ArtifactRef): string | null {
    if (ref.repo?.trim() && typeof ref.number === 'number') {
        return `${ref.repo.trim()}#${ref.number}`
    }
    return parseGithubRefFromUrl(ref.url)
}

export function pickPrimaryArtifactTitle(artifactRefs: ArtifactRef[]): string | null {
    for (const kind of TITLE_PRIORITY_KINDS) {
        const match = artifactRefs.find((ref) => ref.kind === kind)
        if (!match) continue
        const shortRef = shortRepoRef(match)
        const title = match.title?.trim()
        if (title && shortRef) return `${shortRef}: ${title}`
        if (title) return title
        if (shortRef) return shortRef
        if (match.ref?.trim()) return match.ref.trim()
        // Deliberately do NOT fall through to a bare match.url — a naked
        // "https://github.com/…/pull/987" title is exactly the wall we kill.
    }
    for (const ref of artifactRefs) {
        if (ref.title?.trim()) return ref.title.trim()
        const shortRef = shortRepoRef(ref)
        if (shortRef) return shortRef
        if (ref.ref?.trim()) return ref.ref.trim()
    }
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
