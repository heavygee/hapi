import { describe, expect, it } from 'vitest'
import { getLinkedGithubIssue } from './externalRefs'

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

    it('returns the last-appended issue ref — real writers always append in link order', () => {
        const older = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        const newer = { kind: 'github_issue' as const, url: 'https://github.com/heavygee/hapi/issues/236', repo: 'heavygee/hapi', number: 236, linkedAt: 2 }
        expect(getLinkedGithubIssue({ externalRefs: [older, newer] })).toEqual(newer)
    })
})
