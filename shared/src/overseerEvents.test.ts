import { describe, expect, test } from 'bun:test'
import {
    AGENT_NOTIFY_CONTRACT_INLINE_PREFIX,
    deriveAttentionCandidate,
    mapNotifyStatusToEventType,
    buildEventSummaryFromNotify,
    detectEmptyHapiEventsSentinel,
    HAPI_EVENTS_BEGIN,
    HAPI_EVENTS_END
} from './overseerEvents'

describe('overseerEvents mapping', () => {
    test('maps notify status to event_type', () => {
        expect(mapNotifyStatusToEventType('done')).toBe('completed')
        expect(mapNotifyStatusToEventType('stalled')).toBe('stale')
        expect(mapNotifyStatusToEventType('blocked')).toBe('blocked')
    })

    test('derives attention_candidate from status and action', () => {
        expect(deriveAttentionCandidate('blocked')).toBe(1)
        expect(deriveAttentionCandidate('done', '')).toBe(0)
        expect(deriveAttentionCandidate('done', 'Merge PR')).toBe(1)
        expect(deriveAttentionCandidate('needs_decision')).toBe(1)
    })

    test('buildEventSummaryFromNotify prefers summary', () => {
        expect(buildEventSummaryFromNotify({ summary: 'Shipped fix', action: 'Review' })).toBe('Shipped fix')
    })

    test('detectEmptyHapiEventsSentinel finds empty sentinel pair', () => {
        const text = `prose\n${HAPI_EVENTS_BEGIN}${HAPI_EVENTS_END}`
        expect(detectEmptyHapiEventsSentinel(text)).toBe(true)
    })

    test('contract prefix is non-empty', () => {
        expect(AGENT_NOTIFY_CONTRACT_INLINE_PREFIX.length).toBeGreaterThan(40)
        expect(AGENT_NOTIFY_CONTRACT_INLINE_PREFIX).toContain('AGENT_NOTIFY_SUMMARY')
    })
})
