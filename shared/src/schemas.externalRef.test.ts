import { describe, expect, it } from 'vitest'
import { parseIssueUrl, upsertExternalRef, type ExternalRef } from './schemas'

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
})
