import { parseIssueUrl, upsertExternalRef, type ExternalRef } from '@hapi/protocol/schemas'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Metadata } from '@/api/types'

type SessionIssueLinkClient = Pick<ApiSessionClient, 'updateMetadata'>

export type LinkIssueOutcome =
    | { ok: true; ref: ExternalRef }
    | { ok: false; error: string }

/**
 * MCP `link_issue` tool's write path — socket-based via the already-connected
 * client, mirroring applySessionDisplayRename's `change_title` pattern. The
 * standalone `hapi link-issue` CLI command (fresh process, no live socket)
 * goes through the hub REST route instead (`cli/src/modules/linkIssue`); both
 * share `parseIssueUrl` from `shared/` so they validate identically.
 */
export function applyLinkIssue(client: SessionIssueLinkClient, url: string): LinkIssueOutcome {
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

    return { ok: true, ref }
}
