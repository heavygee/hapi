import type { ExternalRef } from '@hapi/protocol/types'
import type { SessionSummary } from '@/types/api'

/**
 * Most recently linked GitHub issue ref, if any. Every known writer
 * (`sessionCache.linkIssue`, `applyLinkIssue`) appends via `upsertExternalRef`,
 * so array order already reflects link order — the last matching entry is the
 * most recent, with no `linkedAt` tie-break needed.
 */
export function getLinkedGithubIssue(metadata: { externalRefs?: ExternalRef[] } | null | undefined): ExternalRef | null {
    const refs = metadata?.externalRefs
    if (!refs || refs.length === 0) return null
    return refs.findLast((ref): ref is ExternalRef & { kind: 'github_issue' } => ref.kind === 'github_issue') ?? null
}

/**
 * The session (if any) already linked to a to-do item's issue URL — used to
 * offer "open the existing session" instead of "spawn another one" from the
 * to-do detail pane (hapi#238 Codex review: revisiting an item that was
 * already spawned-and-linked, including via this exact flow, unconditionally
 * offered another spawn, funneling the user toward duplicate work). First
 * match wins; a URL spawned twice some other way (outside this flow's own
 * dedup) is an edge case not worth picking a "best" session for.
 *
 * Scans every retained `github_issue` ref, not just `getLinkedGithubIssue`'s
 * most-recent one (Codex review, second pass): a session linked to issue A
 * and later also linked to issue B keeps BOTH refs (`upsertExternalRef` only
 * dedups same-issue re-links), so checking only the most-recent ref would
 * stop finding the session while viewing A, even though A is still linked.
 */
export function findSessionLinkedToIssue(sessions: SessionSummary[], issueUrl: string | null): SessionSummary | null {
    if (!issueUrl) return null
    return sessions.find(session =>
        session.metadata?.externalRefs?.some(ref => ref.kind === 'github_issue' && ref.url === issueUrl)
    ) ?? null
}
