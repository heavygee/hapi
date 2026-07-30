import { describe, expect, it } from 'bun:test'
import {
    buildExplainPriority,
    buildInboxTitle,
    buildInboxTitleFromEvent,
    computeCoarseBasePriority,
    mapEventTypeToInboxCategory,
    mapOperatorActionToStatus,
    parseGithubRefFromUrl
} from './overseerInbox'

describe('overseerInbox', () => {
    it('orders coarse rank permission > blocked > needs_decision > completed > stale', () => {
        expect(computeCoarseBasePriority('approval_requested')).toBeLessThan(computeCoarseBasePriority('blocked'))
        expect(computeCoarseBasePriority('blocked')).toBeLessThan(computeCoarseBasePriority('needs_decision'))
        expect(computeCoarseBasePriority('needs_decision')).toBeLessThan(computeCoarseBasePriority('completed'))
        expect(computeCoarseBasePriority('completed')).toBeLessThan(computeCoarseBasePriority('stale'))
    })

    it('gives progress a defined rank below stale (not the unknown default)', () => {
        expect(computeCoarseBasePriority('progress')).toBeGreaterThan(computeCoarseBasePriority('stale'))
        expect(computeCoarseBasePriority('progress')).not.toBe(computeCoarseBasePriority('some_unknown_type'))
    })

    it('demotes external channel items below every worker/system item', () => {
        // The most urgent channel event (blocked PR babysit) must still rank
        // below the least urgent genuine worker item (unknown default = 70).
        const channelBlocked = computeCoarseBasePriority('blocked', 'channel')
        const workerDefault = computeCoarseBasePriority('anything', 'worker')
        expect(channelBlocked).toBeGreaterThan(workerDefault)
        // Order within the channel band is preserved.
        expect(computeCoarseBasePriority('blocked', 'channel'))
            .toBeLessThan(computeCoarseBasePriority('needs_decision', 'channel'))
        expect(computeCoarseBasePriority('completed', 'channel'))
            .toBeLessThan(computeCoarseBasePriority('progress', 'channel'))
        // Non-channel source is unaffected.
        expect(computeCoarseBasePriority('blocked')).toBe(computeCoarseBasePriority('blocked', 'worker'))
    })

    it('maps event types to inbox category badges', () => {
        expect(mapEventTypeToInboxCategory('approval_requested')).toBe('APPROVAL')
        expect(mapEventTypeToInboxCategory('blocked')).toBe('BLOCKED')
        expect(mapEventTypeToInboxCategory('needs_decision')).toBe('QUESTION')
        expect(mapEventTypeToInboxCategory('completed')).toBe('FINALE')
        expect(mapEventTypeToInboxCategory('stale')).toBe('STALE')
    })

    it('prefers artifact title over denormalized session name', () => {
        const refs = JSON.stringify([{ kind: 'github_pr', title: 'fix: inbox substrate' }])
        const payload = JSON.stringify({ session: { name: 'my-session' } })
        expect(buildInboxTitleFromEvent(refs, payload, 'summary body')).toBe('fix: inbox substrate')
        expect(buildInboxTitleFromEvent(null, payload, 'summary body')).toBe('my-session')
        expect(buildInboxTitleFromEvent(null, null, 'summary body')).toBe('summary body')
    })

    it('never renders a bare PR URL as the inbox title (regression: #wall-of-urls)', () => {
        // Real shape emitted by contrib-state before the producer carried a title.
        const refs = JSON.stringify([{
            kind: 'github_pr',
            url: 'https://github.com/tiann/hapi/pull/987',
            repo: 'tiann/hapi',
            number: 987
        }])
        expect(buildInboxTitleFromEvent(refs, null, 'resolve 1 open thread(s)'))
            .toBe('tiann/hapi#987')
    })

    it('combines repo#number with the PR title when the producer carries one', () => {
        const refs = JSON.stringify([{
            kind: 'github_pr',
            url: 'https://github.com/tiann/hapi/pull/1215',
            repo: 'tiann/hapi',
            number: 1215,
            title: 'feat(web): rich composer'
        }])
        expect(buildInboxTitleFromEvent(refs, null, 'x')).toBe('tiann/hapi#1215: feat(web): rich composer')
    })

    it('derives repo#number from a github URL when repo/number fields are absent', () => {
        const refs = JSON.stringify([{ kind: 'github_pr', url: 'https://github.com/tiann/hapi/pull/42' }])
        expect(buildInboxTitleFromEvent(refs, null, 'summary')).toBe('tiann/hapi#42')
        expect(parseGithubRefFromUrl('https://github.com/heavygee/hapi/issues/7')).toBe('heavygee/hapi#7')
        expect(parseGithubRefFromUrl('https://example.com/foo')).toBeNull()
    })

    it('builds explain_priority lite from category age and source ids', () => {
        const now = Date.UTC(2026, 5, 20, 12, 0, 0)
        const createdAt = now - 15 * 60_000
        const text = buildExplainPriority('BLOCKED', createdAt, [42, 43], now)
        expect(text).toContain('BLOCKED tier')
        expect(text).toContain('15m ago')
        expect(text).toContain('2 events')
    })

    it('maps operator actions to inbox status transitions', () => {
        expect(mapOperatorActionToStatus('done')).toBe('resolved')
        expect(mapOperatorActionToStatus('dismiss')).toBe('obsoleted')
        expect(mapOperatorActionToStatus('snooze')).toBe('snoozed')
    })
})
