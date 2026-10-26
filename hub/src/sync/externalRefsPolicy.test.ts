import { describe, expect, it } from 'bun:test'
import { externalRefsInMetadataValid, stripExternalRefsWhenAwarenessDisabled } from './externalRefsPolicy'

const PR_REF = { kind: 'github_pr', repo: 'tiann/hapi', number: 1, url: 'https://github.com/tiann/hapi/pull/1', role: 'primary' }
const ISSUE_REF = { kind: 'github_issue', repo: 'tiann/hapi', number: 2, url: 'https://github.com/tiann/hapi/issues/2', linkedAt: 1 }

describe('stripExternalRefsWhenAwarenessDisabled', () => {
    it('leaves metadata untouched when awareness is enabled', () => {
        const metadata = { path: '/tmp', externalRefs: [PR_REF, ISSUE_REF] }
        expect(stripExternalRefsWhenAwarenessDisabled(metadata, true)).toBe(metadata)
    })

    it('leaves metadata with no externalRefs key untouched', () => {
        const metadata = { path: '/tmp' }
        expect(stripExternalRefsWhenAwarenessDisabled(metadata, false)).toBe(metadata)
    })

    it('strips github_pr refs but keeps github_issue refs — link_issue is always-on, not gated by PR awareness', () => {
        const metadata = { path: '/tmp', externalRefs: [PR_REF, ISSUE_REF] }
        expect(stripExternalRefsWhenAwarenessDisabled(metadata, false)).toEqual({
            path: '/tmp',
            externalRefs: [ISSUE_REF]
        })
    })

    it('strips every github_pr ref, leaving an empty array when nothing else is present', () => {
        const metadata = { path: '/tmp', externalRefs: [PR_REF] }
        expect(stripExternalRefsWhenAwarenessDisabled(metadata, false)).toEqual({
            path: '/tmp',
            externalRefs: []
        })
    })

    it('deletes the whole key when externalRefs is not array-shaped, leaving rejection to externalRefsInMetadataValid', () => {
        const metadata = { path: '/tmp', externalRefs: 'not-an-array' }
        const result = stripExternalRefsWhenAwarenessDisabled(metadata, false) as Record<string, unknown>
        expect('externalRefs' in result).toBe(false)
    })

    it('returns non-object metadata unchanged', () => {
        expect(stripExternalRefsWhenAwarenessDisabled(null, false)).toBeNull()
        expect(stripExternalRefsWhenAwarenessDisabled('x', false)).toBe('x')
    })
})

describe('externalRefsInMetadataValid', () => {
    it('accepts metadata without externalRefs', () => {
        expect(externalRefsInMetadataValid({ path: '/tmp' })).toBe(true)
    })

    it('rejects two primary GitHub PRs', () => {
        expect(externalRefsInMetadataValid({
            path: '/tmp',
            externalRefs: [
                {
                    kind: 'github_pr',
                    repo: 'tiann/hapi',
                    number: 1,
                    url: 'https://github.com/tiann/hapi/pull/1',
                    role: 'primary'
                },
                {
                    kind: 'github_pr',
                    repo: 'tiann/hapi',
                    number: 2,
                    url: 'https://github.com/tiann/hapi/pull/2',
                    role: 'primary'
                }
            ]
        })).toBe(false)
    })
})
