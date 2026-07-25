import { describe, expect, it } from 'vitest'
import { formatGithubPrChipLabel } from './SessionPrChip'
import { getPrimaryGithubPrRef, githubPrStatusFromEmoji, githubPrStatusEmoji } from '@hapi/protocol'

describe('SessionPrChip helpers', () => {
    it('formats the chip label from the PR number only when status is absent', () => {
        expect(formatGithubPrChipLabel({
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 1160,
            url: 'https://github.com/tiann/hapi/pull/1160',
            role: 'primary'
        })).toBe('#1160')
    })

    it('prefixes the Meta status emoji when status is cached on the ref', () => {
        expect(formatGithubPrChipLabel({
            kind: 'github_pr',
            repo: 'tiann/hapi',
            number: 1163,
            url: 'https://github.com/tiann/hapi/pull/1163',
            role: 'primary',
            status: 'needs_work',
            statusCheckedAt: 1_700_000_000_000,
            statusAction: 'fix failing CI'
        })).toBe('⚠️#1163')
    })

    it('does not infer a PR from title-like strings (structured refs only)', () => {
        // Callers must pass metadata.externalRefs — never parse "PR #1160" titles.
        expect(getPrimaryGithubPrRef(undefined)).toBeNull()
        expect(getPrimaryGithubPrRef([])).toBeNull()
    })

    it('maps Meta emoji contract to stable status enums', () => {
        expect(githubPrStatusFromEmoji('✅')).toBe('clean')
        expect(githubPrStatusFromEmoji('⚠️')).toBe('needs_work')
        expect(githubPrStatusEmoji('merged')).toBe('🔧')
    })
})
