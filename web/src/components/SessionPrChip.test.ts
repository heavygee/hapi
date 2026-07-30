import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    formatGithubPrChipLabel,
    formatGithubPrChipTitle,
    GITHUB_PR_CHIP_STALE_MS,
    resolveGithubPrChipDisplay
} from './SessionPrChip'
import { getPrimaryGithubPrRef, githubPrStatusFromEmoji, githubPrStatusEmoji } from '@hapi/protocol'
import type { GithubPrExternalRef } from '@/types/api'

const baseRef = (over: Partial<GithubPrExternalRef> = {}): GithubPrExternalRef => ({
    kind: 'github_pr',
    repo: 'tiann/hapi',
    number: 1163,
    url: 'https://github.com/tiann/hapi/pull/1163',
    role: 'primary',
    ...over
})

const keyedT = (key: string, params?: Record<string, string | number>) =>
    params && 'n' in params ? `${key}:${params.n}` : key

afterEach(() => {
    vi.useRealTimers()
})

describe('SessionPrChip helpers', () => {
    it('formats the chip label from the PR number only when status is absent', () => {
        expect(formatGithubPrChipLabel(baseRef({ number: 1160, url: 'https://github.com/tiann/hapi/pull/1160' }))).toBe('#1160')
    })

    it('prefixes the Meta status emoji when status is cached on the ref', () => {
        const now = 1_700_000_000_000 + 60_000
        expect(formatGithubPrChipLabel(baseRef({
            status: 'needs_work',
            statusCheckedAt: 1_700_000_000_000,
            statusAction: 'fix failing CI'
        }), now)).toBe('⚠️#1163')
    })

    it('mutes to ? when statusCheckedAt is older than 2h', () => {
        const checkedAt = 1_700_000_000_000
        const now = checkedAt + GITHUB_PR_CHIP_STALE_MS + 1
        const ref = baseRef({
            status: 'clean',
            statusCheckedAt: checkedAt
        })
        expect(resolveGithubPrChipDisplay(ref, now)).toEqual({
            status: 'unknown',
            stale: true
        })
        expect(formatGithubPrChipLabel(ref, now)).toBe('?#1163')
    })

    it('keeps tone when cache is fresh', () => {
        const checkedAt = 1_700_000_000_000
        const now = checkedAt + GITHUB_PR_CHIP_STALE_MS - 1
        expect(resolveGithubPrChipDisplay(baseRef({
            status: 'pending',
            statusCheckedAt: checkedAt
        }), now)).toEqual({ status: 'pending', stale: false })
    })

    it('does not treat missing statusCheckedAt as stale', () => {
        expect(resolveGithubPrChipDisplay(baseRef({ status: 'clean' }), Date.now())).toEqual({
            status: 'clean',
            stale: false
        })
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

    it('uses relative ago in chip title (tooltip already - no absolute nest)', () => {
        vi.useFakeTimers()
        const checkedAt = 1_700_000_000_000
        // 90m: still fresh for chip tone (<2h), but past the hours bucket.
        vi.setSystemTime(checkedAt + 90 * 60_000)
        const ref = baseRef({
            status: 'needs_work',
            statusCheckedAt: checkedAt,
            statusAction: 'rebase (merge state dirty)'
        })
        const display = resolveGithubPrChipDisplay(ref, Date.now())
        const title = formatGithubPrChipTitle(ref, display, keyedT)
        expect(title).toBe(
            'tiann/hapi#1163 · needs_work · checked session.time.hoursAgo:1 — rebase (merge state dirty)'
        )
        expect(title).not.toMatch(/T\d{2}:\d{2}:\d{2}/)
    })
})
