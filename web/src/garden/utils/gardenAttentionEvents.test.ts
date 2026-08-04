import { describe, expect, it } from 'vitest'
import {
    createAttentionRecord,
    detectAttentionEvents,
    pickAttentionReason,
    shouldClearAttention,
    shouldPingSession,
    sessionAttentionSnapshot,
} from '@/garden/utils/gardenAttentionEvents'

describe('detectAttentionEvents', () => {
    it('returns nothing on first snapshot', () => {
        expect(detectAttentionEvents(undefined, { thinking: false, pendingRequestKindsCount: 0 })).toEqual([])
    })

    it('detects new permission requests', () => {
        const prev = { thinking: false, pendingRequestKindsCount: 0 }
        const next = { thinking: false, pendingRequestKindsCount: 1 }
        expect(detectAttentionEvents(prev, next)).toEqual(['permission'])
    })

    it('detects ready when thinking stops', () => {
        const prev = { thinking: true, pendingRequestKindsCount: 0 }
        const next = { thinking: false, pendingRequestKindsCount: 0 }
        expect(detectAttentionEvents(prev, next)).toEqual(['ready'])
    })
})

describe('shouldPingSession', () => {
    it('pings when not voice-focused', () => {
        expect(shouldPingSession('a', null)).toBe(true)
        expect(shouldPingSession('a', 'b')).toBe(true)
    })

    it('skips the voice-focused session', () => {
        expect(shouldPingSession('a', 'a')).toBe(false)
    })
})

describe('pickAttentionReason', () => {
    it('prefers permission over ready', () => {
        expect(pickAttentionReason(['ready', 'permission'])).toBe('permission')
    })
})

describe('shouldClearAttention', () => {
    it('does not clear before focus', () => {
        const record = createAttentionRecord('ready', 100)
        expect(shouldClearAttention(record, { pendingRequestKinds: [], updatedAt: 200 })).toBe(false)
    })

    it('clears permission after focus when queue empty', () => {
        const record = createAttentionRecord('permission', 100)
        record.focusBaselineUpdatedAt = 100
        expect(shouldClearAttention(record, { pendingRequestKinds: [], updatedAt: 100 })).toBe(true)
    })

    it('clears ready after focus when session updated', () => {
        const record = createAttentionRecord('ready', 100)
        record.focusBaselineUpdatedAt = 100
        expect(shouldClearAttention(record, { pendingRequestKinds: [], updatedAt: 101 })).toBe(true)
        expect(shouldClearAttention(record, { pendingRequestKinds: [], updatedAt: 100 })).toBe(false)
    })
})

describe('sessionAttentionSnapshot', () => {
    it('copies relevant fields', () => {
        expect(sessionAttentionSnapshot({ thinking: true, pendingRequestKinds: ['permission', 'input', 'other'] })).toEqual({
            thinking: true,
            pendingRequestKindsCount: 3,
        })
    })
})
