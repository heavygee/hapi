import type { ExternalRef, GithubPrExternalRef } from './schemas'

/**
 * Primary GitHub PR chip source. Title/emoji parsing is intentionally not used.
 */
export function getPrimaryGithubPrRef(
    refs: readonly ExternalRef[] | null | undefined
): GithubPrExternalRef | null {
    if (!refs?.length) return null
    for (const ref of refs) {
        if (ref.kind === 'github_pr' && ref.role === 'primary') {
            return ref
        }
    }
    return null
}
