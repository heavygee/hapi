import { describe, expect, it } from 'bun:test'
import {
    buildExplainPriority,
    buildInboxTitle,
    buildInboxTitleFromEvent,
    computeCoarseBasePriority,
    mapEventTypeToInboxCategory,
    mapOperatorActionToStatus
} from './overseerInbox'

describe('overseerInbox', () => {
    it('orders coarse rank permission > blocked > needs_decision > completed > stale', () => {
        expect(computeCoarseBasePriority('approval_requested')).toBeLessThan(computeCoarseBasePriority('blocked'))
        expect(computeCoarseBasePriority('blocked')).toBeLessThan(computeCoarseBasePriority('needs_decision'))
        expect(computeCoarseBasePriority('needs_decision')).toBeLessThan(computeCoarseBasePriority('completed'))
        expect(computeCoarseBasePriority('completed')).toBeLessThan(computeCoarseBasePriority('stale'))
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
