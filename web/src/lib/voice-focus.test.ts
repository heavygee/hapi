import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    getReceivingSessionId,
    isVoiceTransportActive,
    resolveVoiceFocusLabel,
} from './voice-focus'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

describe('voice-focus helpers', () => {
    it('extracts receiving session id from session focus', () => {
        expect(getReceivingSessionId({ kind: 'session', ref: 'sess-abc' })).toBe('sess-abc')
        expect(getReceivingSessionId({ kind: 'overseer' })).toBeNull()
        expect(getReceivingSessionId(null)).toBeNull()
    })

    it('resolves session title for chrome pill label', () => {
        const sessions = [makeSession({ id: 'sess-abc', metadata: { name: 'My feature branch', path: '/work/feature' } })]
        expect(resolveVoiceFocusLabel({ kind: 'session', ref: 'sess-abc' }, sessions)).toBe('My feature branch')
    })

    it('falls back to short id when session row is missing', () => {
        expect(resolveVoiceFocusLabel({ kind: 'session', ref: 'sess-abcdef12' }, [])).toBe('sess-abc')
    })

    it('detects active voice transport states', () => {
        expect(isVoiceTransportActive('connected')).toBe(true)
        expect(isVoiceTransportActive('connecting')).toBe(true)
        expect(isVoiceTransportActive('disconnected')).toBe(false)
    })
})
