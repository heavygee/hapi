import { describe, expect, it } from 'vitest'
import { ExternalRefSchema, MetadataSchema } from './schemas'
import {
    getPrimaryGithubPrRef,
    parseGithubPrInput,
    buildGithubPrExternalRef,
    preserveGithubPrStatusCache,
    githubPrChipStatusFromEmoji,
    primaryGithubPrNeedingStatus,
    withGithubPrChipStatus
} from './externalRefs'

describe('ExternalRefSchema', () => {
    const validPr = {
        kind: 'github_pr' as const,
        repo: 'tiann/hapi',
        number: 1160,
        url: 'https://github.com/tiann/hapi/pull/1160',
        role: 'primary' as const
    }

    it('accepts a github_pr ref', () => {
        const parsed = ExternalRefSchema.safeParse(validPr)
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data).toEqual(validPr)
        }
    })

    it('accepts optional source and linkedAt provenance fields', () => {
        const parsed = ExternalRefSchema.safeParse({
            ...validPr,
            source: 'agent',
            linkedAt: 1_700_000_000_000
        })
        expect(parsed.success).toBe(true)
    })

    it('accepts optional cached status fields (ADR D8)', () => {
        const parsed = ExternalRefSchema.safeParse({
            ...validPr,
            status: 'clean',
            statusCheckedAt: 1_700_000_000_000,
            statusAction: 'full green — wait on tiann'
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.status).toBe('clean')
        }
    })

    it('accepts needs_operator hold status (babysit.hold)', () => {
        const parsed = ExternalRefSchema.safeParse({
            ...validPr,
            status: 'needs_operator',
            statusCheckedAt: 1_700_000_000_000,
            statusAction: 'HOLD @tiann: please trim'
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.status).toBe('needs_operator')
        }
    })

    it('accepts a status value outside this project\'s own vocabulary (operator decision, hapi#238 schema reconciliation)', () => {
        // Regression: status used to be a hardcoded GithubPrStatusSchema enum
        // — this fork's own chip-emoji vocabulary, not a universal concept
        // every project embedding this schema shares. A project with its own
        // PR-workflow status values must be able to write them without the
        // wire schema rejecting the whole ref (and by extension the whole
        // metadata object) over a string it doesn't recognize.
        // GithubPrStatusSchema/GithubPrStatus still exist for this project's
        // own UI code to use as a *display* convenience, just not as the
        // wire-level validator.
        expect(ExternalRefSchema.safeParse({
            ...validPr,
            status: 'purple'
        }).success).toBe(true)
    })

    it('preserves fork-tooling fields beyond the ones this schema explicitly names (operator decision, hapi#238)', () => {
        // Regression: a plain z.object() with no .passthrough() silently
        // strips unrecognized keys on every parse — hapi-meta-daily.sh
        // writes estateCode/openState/checks/merge beyond what this schema
        // ever named, and those would vanish the moment metadata round-trips
        // through this schema without this.
        const parsed = ExternalRefSchema.safeParse({
            ...validPr,
            estateCode: 'fork',
            openState: 'open',
            checks: 'passing',
            merge: 'clean'
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data).toMatchObject({ estateCode: 'fork', openState: 'open', checks: 'passing', merge: 'clean' })
        }
    })

    it('accepts a GHE-hosted PR url, not just github.com (operator decision, hapi#238)', () => {
        // A GHE-hosted project's PRs are exactly as valid a "connection" as a
        // github.com one — the board feature already supports GHE hosts for
        // issues; PRs are no more HAPI/github.com-specific.
        const parsed = ExternalRefSchema.safeParse({
            kind: 'github_pr',
            repo: 'lockhouse/repo',
            number: 9,
            url: 'https://lhs.ghe.com/lockhouse/repo/pull/9',
            role: 'primary'
        })
        expect(parsed.success).toBe(true)
    })

    it('still rejects a userinfo-deceptive url pointing at a different host than it displays', () => {
        const parsed = ExternalRefSchema.safeParse({
            ...validPr,
            url: 'https://github.com@evil.example/tiann/hapi/pull/1160'
        })
        expect(parsed.success).toBe(false)
    })

    it('rejects invalid repo shape', () => {
        expect(ExternalRefSchema.safeParse({ ...validPr, repo: 'not-a-repo' }).success).toBe(false)
        expect(ExternalRefSchema.safeParse({ ...validPr, repo: '/hapi' }).success).toBe(false)
    })

    it('rejects non-positive PR numbers', () => {
        expect(ExternalRefSchema.safeParse({ ...validPr, number: 0 }).success).toBe(false)
        expect(ExternalRefSchema.safeParse({ ...validPr, number: -1 }).success).toBe(false)
    })

    it('rejects URLs that do not match the declared GitHub PR identity', () => {
        expect(ExternalRefSchema.safeParse({
            ...validPr,
            url: 'https://example.test/phish'
        }).success).toBe(false)
        expect(ExternalRefSchema.safeParse({
            ...validPr,
            url: 'https://github.com/other/repo/pull/1160'
        }).success).toBe(false)
        expect(ExternalRefSchema.safeParse({
            ...validPr,
            url: 'https://github.com/tiann/hapi/pull/999'
        }).success).toBe(false)
    })

    it('rejects unknown kinds', () => {
        expect(ExternalRefSchema.safeParse({ ...validPr, kind: 'gitlab_mr' }).success).toBe(false)
    })
})

describe('MetadataSchema.externalRefs', () => {
    const base = { path: '/tmp', host: 'test' }

    it('accepts optional externalRefs array', () => {
        const parsed = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{
                kind: 'github_pr',
                repo: 'owner/name',
                number: 42,
                url: 'https://github.com/owner/name/pull/42',
                role: 'secondary'
            }]
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.externalRefs).toHaveLength(1)
            expect(parsed.data.externalRefs?.[0]?.number).toBe(42)
        }
    })

    it('rejects malformed externalRefs entries', () => {
        expect(MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', repo: 'x', number: 1 }]
        }).success).toBe(false)
    })
})

describe('getPrimaryGithubPrRef', () => {
    it('returns the primary github_pr ref', () => {
        const primary = {
            kind: 'github_pr' as const,
            repo: 'a/b',
            number: 1,
            url: 'https://github.com/a/b/pull/1',
            role: 'primary' as const
        }
        const secondary = {
            kind: 'github_pr' as const,
            repo: 'a/b',
            number: 2,
            url: 'https://github.com/a/b/pull/2',
            role: 'secondary' as const
        }
        expect(getPrimaryGithubPrRef([secondary, primary])).toEqual(primary)
    })

    it('returns null when no primary github_pr exists', () => {
        expect(getPrimaryGithubPrRef(undefined)).toBeNull()
        expect(getPrimaryGithubPrRef([])).toBeNull()
        expect(getPrimaryGithubPrRef([{
            kind: 'github_pr',
            repo: 'a/b',
            number: 9,
            url: 'https://github.com/a/b/pull/9',
            role: 'secondary'
        }])).toBeNull()
    })
})

describe('parseGithubPrInput', () => {
    it('parses owner/repo#N and canonical URLs', () => {
        expect(parseGithubPrInput('tiann/hapi#1162')).toEqual({
            ok: true,
            repo: 'tiann/hapi',
            number: 1162,
            url: 'https://github.com/tiann/hapi/pull/1162'
        })
        expect(parseGithubPrInput('https://github.com/tiann/hapi/pull/1162')).toEqual({
            ok: true,
            repo: 'tiann/hapi',
            number: 1162,
            url: 'https://github.com/tiann/hapi/pull/1162'
        })
    })

    it('rejects non-GitHub or malformed input', () => {
        expect(parseGithubPrInput('').ok).toBe(false)
        expect(parseGithubPrInput('https://gitlab.com/a/b/-/merge_requests/1').ok).toBe(false)
        expect(parseGithubPrInput('not-a-ref').ok).toBe(false)
    })
})

describe('buildGithubPrExternalRef', () => {
    it('builds a canonical primary ref', () => {
        expect(buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1162,
            source: 'agent',
            linkedAt: 42
        })).toEqual({
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 1162,
            url: 'https://github.com/tiann/hapi/pull/1162',
            role: 'primary',
            source: 'agent',
            linkedAt: 42
        })
    })
})

describe('preserveGithubPrStatusCache', () => {
    it('keeps Meta status fields on idempotent same-PR re-link', () => {
        const existing = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1205,
            role: 'primary',
            source: 'inferred',
            linkedAt: 100,
            status: 'needs_work',
            statusCheckedAt: 200,
            statusAction: 'CI failing'
        })]
        const relink = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1205,
            role: 'primary',
            source: 'agent',
            linkedAt: 300
        })]

        expect(preserveGithubPrStatusCache(existing, relink)).toEqual([{
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 1205,
            url: 'https://github.com/tiann/hapi/pull/1205',
            role: 'primary',
            source: 'agent',
            linkedAt: 300,
            status: 'needs_work',
            statusCheckedAt: 200,
            statusAction: 'CI failing'
        }])
    })

    it('does not carry status onto a different PR', () => {
        const existing = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1205,
            status: 'clean',
            statusCheckedAt: 200,
            statusAction: 'green'
        })]
        const next = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 999,
            source: 'user',
            linkedAt: 300
        })]
        expect(preserveGithubPrStatusCache(existing, next)).toEqual(next)
    })

    it('lets an explicit incoming status win', () => {
        const existing = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1205,
            status: 'needs_work',
            statusCheckedAt: 200,
            statusAction: 'old'
        })]
        const next = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1205,
            status: 'clean',
            statusCheckedAt: 400,
            statusAction: 'full green'
        })]
        expect(preserveGithubPrStatusCache(existing, next)).toEqual(next)
    })

    it('keeps prior status but prefers incoming statusCheckedAt (Meta refresh clock)', () => {
        const existing = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 897,
            status: 'clean',
            statusCheckedAt: 200,
            statusAction: 'full green — wait on tiann'
        })]
        const refresh = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 897,
            source: 'inferred',
            linkedAt: 100,
            statusCheckedAt: 999
        })]
        expect(preserveGithubPrStatusCache(existing, refresh)).toEqual([{
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 897,
            url: 'https://github.com/tiann/hapi/pull/897',
            role: 'primary',
            source: 'inferred',
            linkedAt: 100,
            status: 'clean',
            statusCheckedAt: 999,
            statusAction: 'full green — wait on tiann'
        }])
    })
})

describe('first-attach chip status helpers', () => {
    it('maps Meta emoji to chip fields and skips ?', () => {
        expect(githubPrChipStatusFromEmoji('✅', 'full green — wait on tiann', 42)).toEqual({
            status: 'clean',
            statusCheckedAt: 42,
            statusAction: 'full green — wait on tiann'
        })
        expect(githubPrChipStatusFromEmoji('🔁', 'CI running', 42)?.status).toBe('pending')
        expect(githubPrChipStatusFromEmoji('?', 'retry', 42)).toBeNull()
        expect(githubPrChipStatusFromEmoji('❓', 'stale', 42)).toBeNull()
    })

    it('detects primary needing first-attach status and applies fields', () => {
        const bare = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1219,
            source: 'agent',
            linkedAt: 1
        })]
        expect(primaryGithubPrNeedingStatus(bare)?.number).toBe(1219)
        expect(primaryGithubPrNeedingStatus(withGithubPrChipStatus(
            bare,
            1219,
            { status: 'clean', statusCheckedAt: 99, statusAction: 'full green' }
        ))).toBeNull()
    })
})
