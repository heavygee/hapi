import { describe, expect, it } from 'vitest'
import { formatGithubPrChipLabel } from './SessionPrChip'
import { getPrimaryGithubPrRef } from '@hapi/protocol'

describe('SessionPrChip helpers', () => {
    it('formats the chip label from the PR number only', () => {
        expect(formatGithubPrChipLabel({
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 1160,
            url: 'https://github.com/tiann/hapi/pull/1160',
            role: 'primary'
        })).toBe('#1160')
    })

    it('does not infer a PR from title-like strings (structured refs only)', () => {
        // Callers must pass metadata.externalRefs — never parse "PR #1160" titles.
        expect(getPrimaryGithubPrRef(undefined)).toBeNull()
        expect(getPrimaryGithubPrRef([])).toBeNull()
    })
})
