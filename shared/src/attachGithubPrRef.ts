import type { ExternalRef, GithubPrExternalRef } from './schemas'
import {
    buildGithubPrExternalRef,
    preserveGithubPrStatusCache,
    withGithubPrChipStatus,
    type GithubPrChipStatusFields
} from './externalRefs'
import { classifyGithubPrChipStatus } from './runPrEmojiBatch'

export type AttachGithubPrRefInput = {
    repo: string
    number: number
    role?: 'primary' | 'secondary'
    source?: 'agent' | 'user' | 'inferred'
    linkedAt?: number
    existingRefs?: readonly ExternalRef[] | null
    classify?: (repo: string, number: number) => Promise<GithubPrChipStatusFields | null>
}

/**
 * Build a github_pr ref for attach: keep Meta status on same-PR re-link;
 * otherwise classify immediately so the chip is not blank until Meta daily.
 */
export async function buildAttachedGithubPrRefs(
    input: AttachGithubPrRefInput
): Promise<ExternalRef[]> {
    const identity = buildGithubPrExternalRef({
        repo: input.repo,
        number: input.number,
        role: input.role ?? 'primary',
        source: input.source,
        linkedAt: input.linkedAt ?? Date.now()
    })
    const preserved = preserveGithubPrStatusCache(input.existingRefs, [identity])
    const primary = preserved[0] as GithubPrExternalRef
    if (primary.status !== undefined) {
        return preserved
    }

    const classify = input.classify ?? classifyGithubPrChipStatus
    const fields = await classify(input.repo, input.number)
    if (!fields) {
        return preserved
    }
    return withGithubPrChipStatus(preserved, input.number, fields)
}
