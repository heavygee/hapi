import type { ExternalRef } from '@hapi/protocol/types'

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
