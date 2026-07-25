import { describe, expect, it } from 'vitest'
import { ExternalRefSchema, MetadataSchema } from './schemas'
import { getPrimaryGithubPrRef } from './externalRefs'

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
