import { describe, expect, test } from 'bun:test'
import {
    AGENT_NOTIFY_CONTRACT_INLINE_PREFIX,
    buildOverseerSessionIdentity,
    deriveAttentionCandidate,
    deriveSessionDisplayName,
    deriveSessionProject,
    mapNotifyStatusToEventType,
    buildEventSummaryFromNotify,
    detectEmptyHapiEventsSentinel,
    mergeEventPayloadWithSession,
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

    test('buildOverseerSessionIdentity captures name tag project flavor', () => {
        const identity = buildOverseerSessionIdentity({
            id: 'sess-1',
            flavor: 'codex',
            tag: 'meta-triage',
            metadata: { name: 'meta HAPI triage', path: '/coding/hapi' },
            notifyProject: 'hapi'
        })
        expect(identity.name).toBe('meta HAPI triage')
        expect(identity.tag).toBe('meta-triage')
        expect(identity.project).toBe('hapi')
        expect(identity.flavor).toBe('codex')
    })

    test('mergeEventPayloadWithSession embeds session snapshot', () => {
        const json = mergeEventPayloadWithSession(
            { notify_summary: { summary: 'ok' } },
            {
                id: 'sess-1',
                tag: 'meta-triage',
                name: 'meta HAPI triage',
                project: 'hapi',
                flavor: 'codex'
            }
        )
        const payload = JSON.parse(json) as { session: { name: string } }
        expect(payload.session.name).toBe('meta HAPI triage')
    })

    test('deriveSessionDisplayName prefers metadata name over tag', () => {
        expect(deriveSessionDisplayName({ name: 'Display' }, 'tag-only')).toBe('Display')
        expect(deriveSessionDisplayName(null, 'tag-only')).toBe('tag-only')
    })

    test('deriveSessionProject uses path basename', () => {
        expect(deriveSessionProject({ path: '/coding/hapi' })).toBe('hapi')
    })
})
