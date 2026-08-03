import type { ExternalRef, GithubPrExternalRef, GithubPrStatus } from './schemas'
import { GithubRepoSlugSchema } from './schemas'

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

/** Meta title-emoji contract → stable status enum on the ref (ADR D8). */
export function githubPrStatusFromEmoji(emoji: string): GithubPrStatus {
    switch (emoji) {
        case '✅':
            return 'clean'
        case '🔁':
            return 'pending'
        case '⚠️':
            return 'needs_work'
        case '📝':
            return 'pre_pr'
        case '🔧':
            return 'merged'
        case '❓':
        case '?':
            return 'unknown'
        default:
            return 'unknown'
    }
}

export function githubPrStatusEmoji(status: GithubPrStatus | null | undefined): string {
    switch (status) {
        case 'clean':
            return '✅'
        case 'pending':
            return '🔁'
        case 'needs_work':
            return '⚠️'
        case 'pre_pr':
            return '📝'
        case 'merged':
            return '🔧'
        case 'unknown':
            return '❓'
        default:
            return ''
    }
}

export function githubPrUrl(repo: string, number: number): string {
    return `https://github.com/${repo}/pull/${number}`
}

export type ParseGithubPrInputResult =
    | { ok: true; repo: string; number: number; url: string }
    | { ok: false; error: string }

/**
 * Accept a GitHub PR URL or `owner/repo#N` / `owner/repo#PR N` style input.
 * Does not call the network; shape validation only.
 */
export function parseGithubPrInput(raw: string): ParseGithubPrInputResult {
    const trimmed = raw.trim()
    if (!trimmed) {
        return { ok: false, error: 'empty input' }
    }

    const hashMatch = trimmed.match(/^([^/\s]+\/[^/\s]+)\s*#\s*(?:PR\s*)?(\d+)$/i)
    if (hashMatch) {
        const repo = hashMatch[1]
        const number = Number(hashMatch[2])
        const repoParsed = GithubRepoSlugSchema.safeParse(repo)
        if (!repoParsed.success || !Number.isInteger(number) || number <= 0) {
            return { ok: false, error: 'invalid owner/repo#N' }
        }
        return { ok: true, repo: repoParsed.data, number, url: githubPrUrl(repoParsed.data, number) }
    }

    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        return { ok: false, error: 'expected GitHub PR URL or owner/repo#N' }
    }

    if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
        return { ok: false, error: 'expected https://github.com/.../pull/N URL' }
    }

    const pathMatch = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/)
    if (!pathMatch) {
        return { ok: false, error: 'expected https://github.com/owner/repo/pull/N URL' }
    }

    const repoParsed = GithubRepoSlugSchema.safeParse(pathMatch[1])
    const number = Number(pathMatch[2])
    if (!repoParsed.success || !Number.isInteger(number) || number <= 0) {
        return { ok: false, error: 'invalid GitHub PR URL' }
    }

    return {
        ok: true,
        repo: repoParsed.data,
        number,
        url: githubPrUrl(repoParsed.data, number)
    }
}

export function buildGithubPrExternalRef(input: {
    repo: string
    number: number
    role?: 'primary' | 'secondary'
    source?: 'agent' | 'user' | 'inferred'
    linkedAt?: number
    status?: GithubPrStatus
    statusCheckedAt?: number
    statusAction?: string
}): GithubPrExternalRef {
    return {
        kind: 'github_pr',
        repo: input.repo,
        number: input.number,
        url: githubPrUrl(input.repo, input.number),
        role: input.role ?? 'primary',
        ...(input.source ? { source: input.source } : {}),
        ...(input.linkedAt ? { linkedAt: input.linkedAt } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.statusCheckedAt ? { statusCheckedAt: input.statusCheckedAt } : {}),
        ...(input.statusAction ? { statusAction: input.statusAction } : {})
    }
}

/**
 * Identity writers (`link-pr` / MCP / Link PR dialog) send status-less refs.
 * Meta caches health on the same repo#N. On idempotent re-link, keep the
 * last-good status / statusAction unless the incoming write sets `status`
 * explicitly (ADR D8 stickiness — Meta also skips writing `?`).
 *
 * Always prefer an incoming `statusCheckedAt` when present — Meta refresh
 * must be allowed to bump the honesty clock without re-stating status
 * (2026-07-30: omitting status + preserving prior checkedAt caused estate-wide
 * ❓ stale chips after the forge dual-write experiment).
 */
export function preserveGithubPrStatusCache(
    existing: readonly ExternalRef[] | null | undefined,
    next: readonly ExternalRef[]
): ExternalRef[] {
    if (!existing?.length) {
        return [...next]
    }

    return next.map((ref) => {
        if (ref.kind !== 'github_pr' || ref.status !== undefined) {
            return ref
        }

        const prior = existing.find((candidate): candidate is GithubPrExternalRef => (
            candidate.kind === 'github_pr'
            && candidate.repo === ref.repo
            && candidate.number === ref.number
            && candidate.status !== undefined
        ))
        if (!prior) {
            return ref
        }

        return {
            ...ref,
            status: prior.status,
            statusCheckedAt: ref.statusCheckedAt ?? prior.statusCheckedAt,
            ...(ref.statusAction !== undefined
                ? { statusAction: ref.statusAction }
                : prior.statusAction !== undefined
                    ? { statusAction: prior.statusAction }
                    : {})
        }
    })
}

export type GithubPrChipStatusFields = {
    status: GithubPrStatus
    statusCheckedAt: number
    statusAction?: string
}

/** Map Meta batch emoji + action into chip cache fields. Skips `?` (last-good contract). */
export function githubPrChipStatusFromEmoji(
    emoji: string,
    action: string,
    checkedAtMs: number = Date.now()
): GithubPrChipStatusFields | null {
    switch (emoji) {
        case '✅':
        case '🔁':
        case '⚠️':
        case '📝':
        case '🔧': {
            const trimmed = action.trim()
            return {
                status: githubPrStatusFromEmoji(emoji),
                statusCheckedAt: checkedAtMs,
                ...(trimmed ? { statusAction: trimmed } : {})
            }
        }
        default:
            return null
    }
}

/** Primary github_pr ref that still needs a first-attach status fill. */
export function primaryGithubPrNeedingStatus(
    refs: readonly ExternalRef[] | null | undefined
): GithubPrExternalRef | null {
    const primary = getPrimaryGithubPrRef(refs)
    if (!primary || primary.status !== undefined) {
        return null
    }
    return primary
}

export function withGithubPrChipStatus(
    refs: readonly ExternalRef[],
    number: number,
    fields: GithubPrChipStatusFields
): ExternalRef[] {
    return refs.map((ref) => {
        if (ref.kind !== 'github_pr' || ref.number !== number) {
            return ref
        }
        return {
            ...ref,
            status: fields.status,
            statusCheckedAt: fields.statusCheckedAt,
            ...(fields.statusAction !== undefined ? { statusAction: fields.statusAction } : {})
        }
    })
}
