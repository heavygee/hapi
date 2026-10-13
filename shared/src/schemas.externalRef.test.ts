import { describe, expect, it } from 'vitest'
import { mergeExternalRefs, parseIssueUrl, upsertExternalRef, type ExternalRef } from './schemas'

describe('parseIssueUrl', () => {
    it('parses a full https URL', () => {
        expect(parseIssueUrl('https://github.com/heavygee/hapi/issues/235')).toEqual({
            url: 'https://github.com/heavygee/hapi/issues/235',
            repo: 'heavygee/hapi',
            number: 235
        })
    })

    it('parses the owner/repo#N shorthand', () => {
        expect(parseIssueUrl('heavygee/hapi#235')).toEqual({
            url: 'https://github.com/heavygee/hapi/issues/235',
            repo: 'heavygee/hapi',
            number: 235
        })
    })

    it('does not let a URL fragment leak into the captured repo', () => {
        // Regression: the repo-capture group previously allowed `#`, so a URL
        // with a stray fragment before /issues/ produced a malformed repo
        // like "owner/repo#frag" instead of failing to match.
        expect(parseIssueUrl('https://github.com/owner/repo#frag/issues/5')).toBeNull()
    })

    it('rejects garbage input', () => {
        expect(parseIssueUrl('not an issue url')).toBeNull()
        expect(parseIssueUrl('heavygee/hapi#0')).toBeNull()
    })

    it('rejects a URL delimiter embedded in the owner/repo shorthand instead of mis-parsing it (Codex review)', () => {
        // Regression: the repo-capture group previously excluded only `/`,
        // whitespace, and `#` — not `?`/`&`/`=` — so "owner/repo?tab=x#12"
        // matched with repo captured as "repo?tab=x", producing the
        // malformed "https://github.com/owner/repo?tab=x/issues/12" (a
        // browser treats everything after `?` as a query string).
        expect(parseIssueUrl('owner/repo?tab=x#12')).toBeNull()
        expect(parseIssueUrl('https://github.com/owner/repo?tab=x/issues/12')).toBeNull()
    })

    it('still accepts every character GitHub actually allows in owner/repo names', () => {
        expect(parseIssueUrl('my-org/my_repo.js#1')).toEqual({
            url: 'https://github.com/my-org/my_repo.js/issues/1',
            repo: 'my-org/my_repo.js',
            number: 1
        })
    })

    it('parses a GHE-hosted issue URL (Codex review: board items can come from a GHE board, not just github.com)', () => {
        // Regression: this function used to hardcode `github.com` in the URL
        // regex, so every item from a GHE-hosted board (e.g. a view-scoped
        // Lockhouse board on lhs.ghe.com) silently failed to parse — the
        // auto-link-on-spawn gate in router.tsx never even attempted the
        // link call, with no error surfaced anywhere.
        expect(parseIssueUrl('https://lhs.ghe.com/lockhouse/repo/issues/203')).toEqual({
            url: 'https://lhs.ghe.com/lockhouse/repo/issues/203',
            repo: 'lockhouse/repo',
            number: 203
        })
    })

    it('lowercases a mixed-case GHE host but preserves repo casing', () => {
        expect(parseIssueUrl('https://LHS.GHE.com/lockhouse/repo/issues/203')).toEqual({
            url: 'https://lhs.ghe.com/lockhouse/repo/issues/203',
            repo: 'lockhouse/repo',
            number: 203
        })
    })

    it('still defaults the owner/repo#N shorthand to github.com when no host prefix is given', () => {
        expect(parseIssueUrl('heavygee/hapi#235')?.url).toBe('https://github.com/heavygee/hapi/issues/235')
    })

    it('does not mistake a bare, host-less three-segment path for a GHE URL', () => {
        expect(parseIssueUrl('owner/repo/issues/5')).toBeNull()
    })

    it('accepts a host: prefix on the shorthand for a GHE issue (design-consult review)', () => {
        // Regression: before this, the shorthand had no way to express a
        // GHE host at all and always resolved to github.com, risking a
        // confidently-wrong link for a GHE board item.
        expect(parseIssueUrl('lhs.ghe.com:lockhouse/repo#8')).toEqual({
            url: 'https://lhs.ghe.com/lockhouse/repo/issues/8',
            repo: 'lockhouse/repo',
            number: 8
        })
    })

    it('lowercases a shorthand host prefix but preserves repo casing', () => {
        expect(parseIssueUrl('LHS.GHE.com:lockhouse/repo#8')?.url).toBe('https://lhs.ghe.com/lockhouse/repo/issues/8')
    })
})

describe('upsertExternalRef', () => {
    function makeRef(overrides: Partial<ExternalRef> = {}): ExternalRef {
        return { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1, ...overrides }
    }

    it('appends a ref for a new repo+number', () => {
        expect(upsertExternalRef([], makeRef())).toEqual([makeRef()])
    })

    it('replaces an existing ref with the same repo+number instead of duplicating', () => {
        const existing = [makeRef({ linkedAt: 1 })]
        const result = upsertExternalRef(existing, makeRef({ linkedAt: 2 }))
        expect(result).toHaveLength(1)
        expect(result[0]?.linkedAt).toBe(2)
    })

    it('matches repo case-insensitively', () => {
        const existing = [makeRef({ repo: 'HeavyGee/Hapi', linkedAt: 1 })]
        const result = upsertExternalRef(existing, makeRef({ repo: 'heavygee/hapi', linkedAt: 2 }))
        expect(result).toHaveLength(1)
        expect(result[0]?.repo).toBe('heavygee/hapi')
    })

    it('keeps refs for a different repo or number', () => {
        const existing = [makeRef({ number: 236 })]
        const result = upsertExternalRef(existing, makeRef({ number: 235 }))
        expect(result).toHaveLength(2)
    })

    it('keeps refs for the same repo+number on a different host instead of discarding the earlier one (Codex review)', () => {
        // Regression: now that parseIssueUrl accepts any host, the same
        // repo path and issue number can legitimately be two different
        // issues on github.com and a GHE host. Identity must include host.
        const existing = [makeRef({ url: 'https://github.com/heavygee/hapi/issues/235' })]
        const result = upsertExternalRef(existing, makeRef({ url: 'https://ghe.example.com/heavygee/hapi/issues/235' }))
        expect(result).toHaveLength(2)
    })

    it('still replaces a same-host, same-repo+number ref regardless of URL path casing in the host', () => {
        const existing = [makeRef({ url: 'https://GitHub.com/heavygee/hapi/issues/235', linkedAt: 1 })]
        const result = upsertExternalRef(existing, makeRef({ url: 'https://github.com/heavygee/hapi/issues/235', linkedAt: 2 }))
        expect(result).toHaveLength(1)
        expect(result[0]?.linkedAt).toBe(2)
    })
})

describe('mergeExternalRefs', () => {
    function makeRef(overrides: Partial<ExternalRef> = {}): ExternalRef {
        return { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1, ...overrides }
    }

    it('keeps everything from base plus anything incoming-only', () => {
        const base = [makeRef({ number: 1 })]
        const incoming = [makeRef({ number: 2 })]
        const result = mergeExternalRefs(base, incoming)
        expect(result.map(r => r.number).sort()).toEqual([1, 2])
    })

    it('prefers base on an identity collision (the surviving session wins)', () => {
        const base = [makeRef({ linkedAt: 99 })]
        const incoming = [makeRef({ linkedAt: 1 })]
        const result = mergeExternalRefs(base, incoming)
        expect(result).toHaveLength(1)
        expect(result[0]?.linkedAt).toBe(99)
    })

    it('does not mutate base when there is nothing new to add', () => {
        const base = [makeRef()]
        const result = mergeExternalRefs(base, [makeRef()])
        expect(result).toBe(base)
    })

    it('merges github_pr refs too, not just github_issue', () => {
        const prRef: ExternalRef = { kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/100', repo: 'heavygee/hapi', number: 100 }
        const result = mergeExternalRefs([], [prRef])
        expect(result).toEqual([prRef])
    })
})
