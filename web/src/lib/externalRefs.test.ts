import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { findSessionLinkedToIssue, getLinkedGithubIssue } from './externalRefs'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('getLinkedGithubIssue', () => {
    it('returns null when metadata has no externalRefs', () => {
        expect(getLinkedGithubIssue(null)).toBeNull()
        expect(getLinkedGithubIssue(undefined)).toBeNull()
        expect(getLinkedGithubIssue({})).toBeNull()
        expect(getLinkedGithubIssue({ externalRefs: [] })).toBeNull()
    })

    it('returns the single linked issue', () => {
        const ref = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        expect(getLinkedGithubIssue({ externalRefs: [ref] })).toEqual(ref)
    })

    it('returns the ref with the highest linkedAt when refs are already in link order', () => {
        const older = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        const newer = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/236', repo: 'heavygee/hapi', number: 236, linkedAt: 2 }
        expect(getLinkedGithubIssue({ externalRefs: [older, newer] })).toEqual(newer)
    })

    it('returns the ref with the highest linkedAt even when array order is reversed (Codex review)', () => {
        // Regression: mergeExternalRefs (duplicate-session/resume merges)
        // appends incoming-only refs after base's, regardless of their real
        // linkedAt — a plain "last in the array" heuristic would pick the
        // older ref here, switching the session's displayed issue chip to a
        // stale link after a merge.
        const older = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        const newer = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/236', repo: 'heavygee/hapi', number: 236, linkedAt: 2 }
        expect(getLinkedGithubIssue({ externalRefs: [newer, older] })).toEqual(newer)
    })

    it('breaks a linkedAt tie by picking the later array entry, matching prior behavior', () => {
        const first = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        const second = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/236', repo: 'heavygee/hapi', number: 236, linkedAt: 1 }
        expect(getLinkedGithubIssue({ externalRefs: [first, second] })).toEqual(second)
    })
})

describe('findSessionLinkedToIssue', () => {
    it('finds the session whose externalRefs link the given issue URL', () => {
        const target = makeSession({
            id: 'session-1',
            metadata: {
                path: '/x', name: 'n', flavor: 'codex',
                externalRefs: [{ kind: 'github_issue', url: 'https://github.com/a/b/issues/1', repo: 'a/b', number: 1, linkedAt: 1 }]
            }
        })
        const other = makeSession({ id: 'session-2', metadata: null })
        expect(findSessionLinkedToIssue([other, target], 'https://github.com/a/b/issues/1')).toBe(target)
    })

    it('returns null when no session links that URL', () => {
        const session = makeSession({ id: 'session-1', metadata: null })
        expect(findSessionLinkedToIssue([session], 'https://github.com/a/b/issues/1')).toBeNull()
    })

    it('returns null for a null issue URL without scanning sessions', () => {
        const session = makeSession({ id: 'session-1', metadata: null })
        expect(findSessionLinkedToIssue([session], null)).toBeNull()
    })

    it('finds a session by an OLDER linked issue even after it was also linked to a newer one (Codex review)', () => {
        // upsertExternalRef only dedups same-issue re-links — linking a
        // second, different issue retains both refs. getLinkedGithubIssue
        // (used for the chip display) only surfaces the newest one; this
        // function must still find the session by the older issue's URL.
        const session = makeSession({
            id: 'session-1',
            metadata: {
                path: '/x', name: 'n', flavor: 'codex',
                externalRefs: [
                    { kind: 'github_issue', url: 'https://github.com/a/b/issues/1', repo: 'a/b', number: 1, linkedAt: 1 },
                    { kind: 'github_issue', url: 'https://github.com/a/b/issues/2', repo: 'a/b', number: 2, linkedAt: 2 }
                ]
            }
        })
        expect(findSessionLinkedToIssue([session], 'https://github.com/a/b/issues/1')).toBe(session)
        expect(findSessionLinkedToIssue([session], 'https://github.com/a/b/issues/2')).toBe(session)
    })

    it('matches case-insensitively — a ref created via a differently-cased `hapi link-issue` URL still matches the item\'s canonical URL (Codex review)', () => {
        const session = makeSession({
            id: 'session-1',
            metadata: {
                path: '/x', name: 'n', flavor: 'codex',
                // Whatever casing the caller typed into `hapi link-issue` —
                // not normalized to GitHub's canonical owner/repo casing.
                externalRefs: [{ kind: 'github_issue', url: 'https://github.com/acme/widgets/issues/12', repo: 'acme/widgets', number: 12, linkedAt: 1 }]
            }
        })
        // The board item's own URL, as returned by the GraphQL API.
        expect(findSessionLinkedToIssue([session], 'https://github.com/Acme/Widgets/issues/12')).toBe(session)
    })

    it('matches on a non-github.com (GHE) host — not hardcoded to github.com', () => {
        const session = makeSession({
            id: 'session-1',
            metadata: {
                path: '/x', name: 'n', flavor: 'codex',
                externalRefs: [{ kind: 'github_issue', url: 'https://ghe.example/acme/widgets/issues/12', repo: 'acme/widgets', number: 12, linkedAt: 1 }]
            }
        })
        expect(findSessionLinkedToIssue([session], 'https://ghe.example/acme/widgets/issues/12')).toBe(session)
    })

    it('does NOT match the same repo/number on a different host (Codex review, fourth pass)', () => {
        // A session linked to acme/widgets#12 on github.com must not be
        // reported as the linked session for the unrelated acme/widgets#12
        // on a GHE host, even though repo and number happen to coincide.
        const session = makeSession({
            id: 'session-1',
            metadata: {
                path: '/x', name: 'n', flavor: 'codex',
                externalRefs: [{ kind: 'github_issue', url: 'https://github.com/acme/widgets/issues/12', repo: 'acme/widgets', number: 12, linkedAt: 1 }]
            }
        })
        expect(findSessionLinkedToIssue([session], 'https://ghe.example/acme/widgets/issues/12')).toBeNull()
    })
})
