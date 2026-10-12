import type { ExternalRef } from '@hapi/protocol/types'
import type { SessionSummary } from '@/types/api'

// Host-agnostic — boards aren't github.com-only (GHE hosts too), unlike
// `@hapi/protocol/schemas`' parseIssueUrl, which is hardcoded to github.com
// and would silently fail to match every GHE-hosted item.
const ISSUE_URL_PATH = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/

function parseHostRepoAndNumber(url: string): { host: string; repo: string; number: number } | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    const match = ISSUE_URL_PATH.exec(parsed.pathname)
    if (!match) return null
    const [, owner, repo, numberRaw] = match
    return { host: parsed.host.toLowerCase(), repo: `${owner}/${repo}`, number: Number(numberRaw) }
}

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
 * The session (if any) already linked to a board item's issue URL — used to
 * offer "open the existing session" instead of "spawn another one" from the
 * board detail pane (hapi#238 Codex review: revisiting an item that was
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
 *
 * Matches by parsed host+repo+number, not raw URL string equality (Codex
 * review, third and fourth passes): GitHub repo paths are case-insensitive,
 * and a ref created via `hapi link-issue owner/repo#N` preserves whatever
 * casing the caller typed, which can differ from the board item's own
 * canonically-cased URL for the same issue — `upsertExternalRef` already
 * treats `repo` case-insensitively for its own dedup, so this mirrors that
 * convention. The host must also match: GHE boards are explicitly supported
 * alongside github.com, so `Owner/Repo#12` on github.com and on a GHE host
 * are different issues that happen to share a repo path and number — only
 * comparing repo+number would conflate them into a false "already linked".
 */
export function findSessionLinkedToIssue(sessions: SessionSummary[], issueUrl: string | null): SessionSummary | null {
    if (!issueUrl) return null
    const target = parseHostRepoAndNumber(issueUrl)
    if (!target) return null
    return sessions.find(session =>
        session.metadata?.externalRefs?.some(ref => {
            if (ref.kind !== 'github_issue' || ref.number !== target.number) return false
            const refParsed = parseHostRepoAndNumber(ref.url)
            return refParsed?.host === target.host && refParsed.repo.toLowerCase() === target.repo.toLowerCase()
        })
    ) ?? null
}
