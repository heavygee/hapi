import { describe, expect, test } from 'bun:test'
import {
    AGENT_NOTIFY_CONTRACT_INLINE_PREFIX,
    buildOverseerSessionIdentity,
    buildUrlArtifactRefs,
    defaultAttentionCandidate,
    deriveAttentionCandidate,
    deriveSessionDisplayName,
    deriveSessionProject,
    extractHttpUrls,
    isNoOpAction,
    mapNotifyStatusToEventType,
    buildEventSummaryFromNotify,
    detectEmptyHapiEventsSentinel,
    mergeEventPayloadWithSession,
    normalizeUrlIdempotencyKey,
    openLoopBucket,
    OVERSEER_EVENT_TYPES,
    OVERSEER_OPEN_LOOP_EVENT_TYPES,
    HAPI_EVENTS_BEGIN,
    HAPI_EVENTS_END,
    stripAgentContract,
    usableNotifyAction,
    usableNotifyToken
} from './overseerEvents'
import { extractNotifySummary } from './messages'

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
        expect(deriveAttentionCandidate('done', 'none')).toBe(0)
        expect(deriveAttentionCandidate('done', '<=12 words')).toBe(0)
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

    test('usableNotifyToken rejects angle-bracket prompt examples', () => {
        expect(usableNotifyToken('<project>')).toBeNull()
        expect(usableNotifyToken('<agent-id>')).toBeNull()
        expect(usableNotifyToken('  <project>  ')).toBeNull()
        expect(usableNotifyToken('hapi')).toBe('hapi')
        expect(usableNotifyToken('')).toBeNull()
    })

    test('usableNotifyAction rejects sentinels', () => {
        expect(usableNotifyAction('none')).toBeNull()
        expect(usableNotifyAction('<=12 words')).toBeNull()
        expect(usableNotifyAction('N/A')).toBeNull()
        expect(usableNotifyAction('Merge PR')).toBe('Merge PR')
    })

    test('buildOverseerSessionIdentity ignores placeholder notify.project', () => {
        const identity = buildOverseerSessionIdentity({
            id: 'sess-1',
            flavor: 'claude',
            metadata: { path: '/coding/hapi/worktrees/overseer-summary-emit' },
            notifyProject: '<project>'
        })
        expect(identity.project).toBe('overseer-summary-emit')
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
        expect(deriveSessionProject({ path: 'C:\\repo\\hapi' })).toBe('hapi')
        expect(deriveSessionProject({ path: 'C:/repo/hapi' })).toBe('hapi')
    })

    test('extractHttpUrls strips trailing punctuation and dedupes', () => {
        const urls = extractHttpUrls(
            'see https://github.com/tiann/hapi/pull/22. also https://example.com/docs and https://example.com/docs'
        )
        expect(urls).toEqual([
            'https://github.com/tiann/hapi/pull/22',
            'https://example.com/docs'
        ])
    })

    test('buildUrlArtifactRefs uses kind url', () => {
        const refs = buildUrlArtifactRefs(['https://example.com'], 'inferred', 1000)
        expect(refs).toEqual([{
            kind: 'url',
            url: 'https://example.com',
            source: 'inferred',
            created_at: 1000
        }])
    })

    test('OVERSEER_EVENT_TYPES includes link_seen and operator_pin', () => {
        expect(OVERSEER_EVENT_TYPES).toContain('link_seen')
        expect(OVERSEER_EVENT_TYPES).toContain('operator_pin')
        expect(defaultAttentionCandidate('link_seen')).toBe(0)
        expect(defaultAttentionCandidate('operator_pin')).toBe(0)
    })

    test('normalizeUrlIdempotencyKey drops hash and lowercases host', () => {
        expect(normalizeUrlIdempotencyKey('https://Example.COM/path/#frag')).toBe('https://example.com/path')
    })

    test('isNoOpAction treats placeholders and empties as no action', () => {
        for (const noop of ['', '  ', 'none', 'None.', 'N/A', 'complete', 'Done', 'nothing', 'no action', 'optional', '-', '—', 'tbd']) {
            expect(isNoOpAction(noop)).toBe(true)
        }
        expect(isNoOpAction(null)).toBe(true)
        expect(isNoOpAction(undefined)).toBe(true)
    })

    test('isNoOpAction keeps a real next step', () => {
        expect(isNoOpAction('Merge PR #99')).toBe(false)
        expect(isNoOpAction('choose deploy target')).toBe(false)
    })

    test('openLoopBucket splits waiting-on-you from half-finished', () => {
        expect(openLoopBucket('needs_decision')).toBe('waiting_on_you')
        expect(openLoopBucket('needs_review')).toBe('waiting_on_you')
        expect(openLoopBucket('blocked')).toBe('half_finished')
        expect(openLoopBucket('failed')).toBe('half_finished')
        expect(openLoopBucket('stale')).toBe('half_finished')
    })

    test('OVERSEER_OPEN_LOOP_EVENT_TYPES excludes completed and progress', () => {
        expect(OVERSEER_OPEN_LOOP_EVENT_TYPES).not.toContain('completed')
        expect(OVERSEER_OPEN_LOOP_EVENT_TYPES).not.toContain('progress')
        expect(OVERSEER_OPEN_LOOP_EVENT_TYPES).toContain('needs_decision')
    })
})

describe('stripAgentContract (render-only, human-facing)', () => {
    test('strips a correct trailing summary line + the blank line above it', () => {
        const text = 'Here is the answer.\n\nAGENT_NOTIFY_SUMMARY {"status":"done","summary":"ok"}'
        expect(stripAgentContract(text)).toBe('Here is the answer.')
    })

    test('strips a corrupted (SUMARY) trailing summary line', () => {
        const text = 'Here is the answer.\nAGENT_NOTIFY_SUMARY {"status":"done"}'
        expect(stripAgentContract(text)).toBe('Here is the answer.')
    })

    test('strips the leading inline-contract prefix block (historical stored msgs)', () => {
        const text = `${AGENT_NOTIFY_CONTRACT_INLINE_PREFIX}please do the thing`
        expect(stripAgentContract(text)).toBe('please do the thing')
    })

    test('strips both leading prefix and trailing summary in one pass', () => {
        const text = `${AGENT_NOTIFY_CONTRACT_INLINE_PREFIX}real content\nAGENT_NOTIFY_SUMMARY {"status":"done"}`
        expect(stripAgentContract(text)).toBe('real content')
    })

    test('leaves a quoted-but-not-last token untouched', () => {
        const text = 'I emit AGENT_NOTIFY_SUMMARY {json} at the end.\nThen more prose.'
        expect(stripAgentContract(text)).toBe(text)
    })

    test('no-ops on clean text and empty input', () => {
        expect(stripAgentContract('just a normal reply')).toBe('just a normal reply')
        expect(stripAgentContract('')).toBe('')
    })

    test('round-trip invariant: overseer still parses raw, human view has no marker', () => {
        const raw = 'Work done.\nAGENT_NOTIFY_SUMARY {"status":"done","summary":"shipped"}'
        // overseer reads the RAW text and still gets the event (corruption-tolerant)
        expect(extractNotifySummary(raw)?.summary).toBe('shipped')
        // the human render is stripped clean and can no longer parse a marker
        const human = stripAgentContract(raw)
        expect(human).toBe('Work done.')
        expect(extractNotifySummary(human)).toBeNull()
    })
})
