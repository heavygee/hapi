import { describe, expect, it } from 'vitest'
import {
    detectOperatorWriteTools,
    isWriteToolCallAuthorized,
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
    })
})

describe('resolveOverseerWriteAuthorization', () => {
    it('explicit allowWrites unlocks both write tools', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'what is in the inbox?',
            allowWrites: true
        })
        expect(auth.explicitClientFlag).toBe(true)
        expect(isWriteToolCallAuthorized('ping_session', {
            sessionId: 'abcdef12-0000-0000-0000-000000000001',
            message: 'hi'
        }, auth).ok).toBe(true)
    })

    it('binds ping_session to the session id named by the operator', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'ping session abcdef12: "please continue"'
        })
        expect(isWriteToolCallAuthorized('ping_session', {
            sessionId: 'abcdef12-ffff-ffff-ffff-ffffffffffff',
            message: 'please continue'
        }, auth).ok).toBe(true)
        expect(isWriteToolCallAuthorized('ping_session', {
            sessionId: 'deadbeef-ffff-ffff-ffff-ffffffffffff',
            message: 'please continue'
        }, auth).ok).toBe(false)
    })

    it('binds short named session tokens after the word session', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'ping session sess-1: "hi"'
        })
        expect(isWriteToolCallAuthorized('ping_session', {
            sessionId: 'sess-1',
            message: 'hi'
        }, auth).ok).toBe(true)
    })

    it('denies ping without a concrete target in the operator message', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'ping that worker to continue'
        })
        const result = isWriteToolCallAuthorized('ping_session', {
            sessionId: 'abcdef12',
            message: 'continue'
        }, auth)
        expect(result.ok).toBe(false)
    })

    it('denies write tools when neither flag nor intent matches', () => {
        const auth = resolveOverseerWriteAuthorization({
            latestOperatorText: 'summarize the inbox'
        })
        expect(isWriteToolCallAuthorized('ping_session', { sessionId: 'x', message: 'y' }, auth).ok).toBe(false)
        expect(isWriteToolCallAuthorized('query_inbox', {}, auth).ok).toBe(true)
    })
})
