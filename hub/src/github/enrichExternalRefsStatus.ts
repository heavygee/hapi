import {
    primaryGithubPrNeedingStatus,
    withGithubPrChipStatus
} from '@hapi/protocol'
import { classifyGithubPrChipStatus } from '@hapi/protocol/runPrEmojiBatch'
import type { ExternalRef } from '@hapi/protocol'
import type { SessionCache } from '@/sync/sessionCache'

/**
 * After an identity-only attach (Link PR dialog / failed CLI classify), fill
 * chip status via Meta's hapi-pr-emoji-batch when the primary still lacks it.
 * Fire-and-forget from setSessionExternalRefs — never blocks the PUT.
 */
export async function enrichSessionExternalRefsStatus(
    sessionCache: SessionCache,
    sessionId: string
): Promise<void> {
    const session = sessionCache.getSession(sessionId)
        ?? sessionCache.refreshSession(sessionId)
    if (!session) {
        return
    }

    const refs = (session.metadata?.externalRefs ?? []) as ExternalRef[]
    const needing = primaryGithubPrNeedingStatus(refs)
    if (!needing) {
        return
    }

    const fields = await classifyGithubPrChipStatus(needing.repo, needing.number)
    if (!fields) {
        return
    }

    const enriched = withGithubPrChipStatus(refs, needing.number, fields)
    await sessionCache.setSessionExternalRefs(sessionId, enriched, { skipStatusEnrichment: true })
}
