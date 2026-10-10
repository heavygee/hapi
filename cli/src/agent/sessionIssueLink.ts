import { parseIssueUrl, upsertExternalRef, type ExternalRef } from '@hapi/protocol/schemas'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Metadata } from '@/api/types'

type SessionIssueLinkClient = Pick<ApiSessionClient, 'updateMetadata' | 'flushMetadata'>

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
 * actually acked — or even after it silently failed (session hub-archived,
 * client closed) — which is wrong for a one-shot tool call the agent only
 * makes once per issue, unlike the high-frequency callers that pattern was
 * built for (hapi#238 Codex review).
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

    return { ok: true, ref }
}
