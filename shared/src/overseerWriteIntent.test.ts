import { describe, expect, it } from 'vitest'
import {
    detectOperatorWriteTools,
    isWriteToolAuthorized,
    resolveOverseerWriteAuthorization
} from './overseerWriteIntent'

describe('detectOperatorWriteTools', () => {
    it('authorizes relay for ping/tell session phrasing', () => {
        expect([...detectOperatorWriteTools('ping the expenses session: please continue')]).toEqual([
            'ping_session'
        ])
        expect([...detectOperatorWriteTools('tell that worker to retry the flaky test')]).toContain(
            'ping_session'
        )
    })

    it('authorizes disposition for snooze/done phrasing', () => {
        expect([...detectOperatorWriteTools('snooze item 12 until tomorrow')]).toEqual([
            'record_disposition'
        ])
        expect([...detectOperatorWriteTools('mark #7 done')]).toContain('record_disposition')
    })

    it('does not authorize writes for read-only questions', () => {
        expect([...detectOperatorWriteTools('what needs my attention?')]).toEqual([])
        expect([...detectOperatorWriteTools('show recent output for session abc')]).toEqual([])
    })
})

describe('resolveOverseerWriteAuthorization', () => {
    it('explicit allowWrites unlocks both write tools', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'what is in the inbox?',
            allowWrites: true
        })
        expect(auth.explicitClientFlag).toBe(true)
        expect(isWriteToolAuthorized('ping_session', auth)).toBe(true)
        expect(isWriteToolAuthorized('record_disposition', auth)).toBe(true)
    })

    it('denies write tools when neither flag nor intent matches', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'summarize the inbox'
        })
        expect(isWriteToolAuthorized('ping_session', auth)).toBe(false)
        expect(isWriteToolAuthorized('query_inbox', auth)).toBe(true)
    })
})
