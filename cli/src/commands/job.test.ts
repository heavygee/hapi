import { describe, expect, it } from 'vitest'
import { parseJobArgs } from '@/commands/job'
import {
    SessionJobError,
    exitCodeForSessionJobError,
    resolveSessionByPrefix,
    resolveSessionIdForJobCli
} from '@/modules/sessionJob/sessionJob'

describe('parseJobArgs', () => {
    it('parses set with long flags', () => {
        const parsed = parseJobArgs([
            'set',
            'abcd1234',
            'beets',
            '--label',
            'beets import',
            '--remaining',
            '12',
            '--unit=tracks'
        ])
        expect(parsed.action).toBe('set')
        expect(parsed.sessionIdPrefix).toBe('abcd1234')
        expect(parsed.jobKey).toBe('beets')
        expect(parsed.label).toBe('beets import')
        expect(parsed.remaining).toBe(12)
        expect(parsed.unit).toBe('tracks')
    })

    it('parses run with command after --', () => {
        const parsed = parseJobArgs([
            'run',
            'sid',
            'drain',
            '--label=rsync',
            '--heartbeat-sec=60',
            '--',
            'bash',
            '-c',
            'echo hi'
        ])
        expect(parsed.action).toBe('run')
        expect(parsed.label).toBe('rsync')
        expect(parsed.heartbeatSec).toBe(60)
        expect(parsed.command).toEqual(['bash', '-c', 'echo hi'])
    })

    it('rejects bad status', () => {
        expect(() => parseJobArgs(['update', 's', 'k', '--status', 'nope'])).toThrow(SessionJobError)
    })

    it('parses --wake-on-terminal and --wake-prompt on update (dogfood arm-later)', () => {
        const parsed = parseJobArgs([
            'update',
            'c88c8925-1276-4ba3-9ba4-eb72fcacc7c8',
            'oos-llm-from-studio',
            '--done',
            '1',
            '--total',
            '2',
            '--wake-on-terminal',
            '--wake-prompt',
            'delete studio dupes'
        ])
        expect(parsed.action).toBe('update')
        expect(parsed.wakeOnTerminal).toBe(true)
        expect(parsed.wakePrompt).toBe('delete studio dupes')
        expect(parsed.done).toBe(1)
        expect(parsed.total).toBe(2)
    })

    it('parses --wake-prompt= on run', () => {
        const parsed = parseJobArgs([
            'run',
            'sid',
            'drain',
            '--label=rsync',
            '--wake-on-terminal',
            '--wake-prompt=Next chunk',
            '--',
            'true'
        ])
        expect(parsed.wakeOnTerminal).toBe(true)
        expect(parsed.wakePrompt).toBe('Next chunk')
        expect(parsed.command).toEqual(['true'])
    })

    it('rejects --wake-prompt without a value', () => {
        expect(() => parseJobArgs([
            'update',
            'sid',
            'k',
            '--wake-on-terminal',
            '--wake-prompt'
        ])).toThrow(/--wake-prompt requires a value/)
    })

    it('parses --started-at for set', () => {
        const parsed = parseJobArgs([
            'set',
            'sid',
            'beets',
            '--label=beets',
            '--started-at=1785304595000'
        ])
        expect(parsed.startedAt).toBe(1_785_304_595_000)
    })
})

describe('resolveSessionByPrefix', () => {
    const sessions = [
        { id: 'aaaaaaaa-1111-1111-1111-111111111111' },
        { id: 'bbbbbbbb-2222-2222-2222-222222222222' },
        { id: 'bbbbcccc-3333-3333-3333-333333333333' }
    ]

    it('matches exact id', () => {
        expect(resolveSessionByPrefix(sessions, sessions[0]!.id).id).toBe(sessions[0]!.id)
    })

    it('matches unique prefix', () => {
        expect(resolveSessionByPrefix(sessions, 'aaaa').id).toBe(sessions[0]!.id)
    })

    it('errors on ambiguous prefix', () => {
        expect(() => resolveSessionByPrefix(sessions, 'bbbb')).toThrow(/matches 2 sessions/)
    })

    it('errors on no match', () => {
        expect(() => resolveSessionByPrefix(sessions, 'zzzz')).toThrow(/no session matching/)
    })
})

describe('resolveSessionIdForJobCli', () => {
    it('passes a full UUID through when missing from the session list', () => {
        const deleted = 'cccccccc-4444-4444-4444-444444444444'
        expect(resolveSessionIdForJobCli([], deleted)).toBe(deleted)
    })

    it('still errors for a non-uuid prefix with no list match', () => {
        expect(() => resolveSessionIdForJobCli([], 'deadbeef')).toThrow(/no session matching/)
    })
})

describe('exitCodeForSessionJobError', () => {
    it('maps codes', () => {
        expect(exitCodeForSessionJobError(new SessionJobError('bad_args', 'x'))).toBe(2)
        expect(exitCodeForSessionJobError(new SessionJobError('auth_failed', 'x'))).toBe(3)
        expect(exitCodeForSessionJobError(new SessionJobError('not_found', 'x'))).toBe(4)
        expect(exitCodeForSessionJobError(new SessionJobError('ambiguous', 'x'))).toBe(5)
        expect(exitCodeForSessionJobError(new SessionJobError('request_failed', 'x'))).toBe(1)
    })
})
