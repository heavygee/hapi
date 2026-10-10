import { parseIssueUrl, upsertExternalRef, type ExternalRef } from '@hapi/protocol/schemas'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Metadata } from '@/api/types'

type SessionIssueLinkClient = Pick<ApiSessionClient, 'updateMetadata' | 'flushMetadata' | 'getMetadata'>

export type LinkIssueOutcome =
    | { ok: true; ref: ExternalRef }
    | { ok: false; error: string }

/**
 * MCP `link_issue` tool's write path — socket-based via the already-connected
 * client, mirroring applySessionDisplayRename's `change_title` pattern. The
 * standalone `hapi link-issue` CLI command (fresh process, no live socket)
 * goes through the hub REST route instead (`cli/src/modules/linkIssue`); both
 * share `parseIssueUrl` from `shared/` so they validate identically.
 *
 * `updateMetadata` is fire-and-forget by design (hot path for every turn),
 * so without `flushMetadata` this would report success before the write is
 * actually acked. But `flushMetadata` only proves the metadata lock drained
 * — if the session was hub-archived mid-flight, `updateMetadata`'s own
 * backoff loop skips the write entirely (`apiSession.ts`'s hub-archived
 * EXIT branch) and the lock still drains "successfully" with nothing ever
 * sent. So after flushing, re-read `client.metadata` and confirm the ref
 * actually landed before reporting success (hapi#238 Codex review, two
 * passes — first catching the fire-and-forget gap, then this skipped-write
 * gap in the fix for it).
 */
export async function applyLinkIssue(client: SessionIssueLinkClient, url: string): Promise<LinkIssueOutcome> {
    const target = parseIssueUrl(url)
    if (!target) {
        return { ok: false, error: 'Could not parse a GitHub issue URL (expected e.g. https://github.com/<owner>/<repo>/issues/<n> or <owner>/<repo>#<n>)' }
    }

    const ref: ExternalRef = {
        kind: 'github_issue',
        url: target.url,
        repo: target.repo,
        number: target.number,
        linkedAt: Date.now()
    }

    client.updateMetadata((metadata: Metadata) => ({
        ...metadata,
        externalRefs: upsertExternalRef(metadata.externalRefs ?? [], ref)
    }))

    const flushed = await client.flushMetadata()
    if (!flushed) {
        return { ok: false, error: 'Timed out waiting for the link to be saved. The session may be closed or unreachable — try again.' }
    }

    // A drained lock alone doesn't prove the write happened: if the session
    // was hub-archived mid-flight, updateMetadata's own backoff loop skips
    // the handler entirely and the lock still drains "successfully."
    const written = client.getMetadata()?.externalRefs?.some(
        (existing) => existing.kind === ref.kind && existing.repo === ref.repo && existing.number === ref.number && existing.linkedAt === ref.linkedAt
    )
    if (!written) {
        return { ok: false, error: 'Could not confirm the link was saved. The session may have been archived mid-write — try again.' }
    }

    return { ok: true, ref }
}
