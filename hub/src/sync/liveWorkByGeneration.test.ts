import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import {
    generationEntryHasWork,
    generationEntryProbeClearable,
    isRunnerOwnedSession,
    liveWorkByGenerationHasWork,
    liveWorkOwnerKey,
    projectLegacyLiveWork,
    UNKNOWN_GENERATION_KEY,
} from './liveWorkByGeneration'

const NOW = 1_800_000_000_000

function session(overrides: Partial<Session> = {}): Session {
    return {
        id: 'sid',
        namespace: 'default',
        seq: 0,
        createdAt: NOW,
        updatedAt: NOW,
        active: true,
        activeAt: NOW,
        metadata: { path: '/tmp/p', host: 'h' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: NOW,
        ...overrides,
    } as Session
}

describe('liveWorkByGeneration helpers', () => {
    it('projects legacy latches by marker only — never attaches current-row pid', () => {
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            machineId: 'm1',
            hostPid: 42,
            hostStartMarker: 'worker-A',
            unresolvedTurn: { since: NOW - 1000, hostStartMarker: 'worker-A' },
            backgroundWork: {
                tasks: [{ id: 'bg-1', type: 'local_bash', description: 'sleep' }],
                hostStartMarker: 'worker-A',
            },
        } as Session['metadata'])
        expect(Object.keys(map)).toEqual(['worker-A'])
        expect(map['worker-A']?.unresolvedTurn).toBe(true)
        expect(map['worker-A']?.backgroundTasks).toHaveLength(1)
        expect(map['worker-A']?.hostPid).toBeUndefined()
        expect(map['worker-A']?.machineId).toBe('')
        expect(map['worker-A']?.hostStartMarker).toBe('worker-A')
        expect(generationEntryProbeClearable(
            session({ metadata: { path: '/tmp/p', host: 'h', startedBy: 'runner', machineId: 'm1' } }),
            'worker-A',
            map['worker-A']!,
        )).toBe(false)
    })

    it('uses the reserved unknown key when legacy latches have no marker', () => {
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            unresolvedTurn: { since: NOW },
        } as Session['metadata'])
        expect(map[UNKNOWN_GENERATION_KEY]?.unresolvedTurn).toBe(true)
        expect(liveWorkByGenerationHasWork(map)).toBe(true)
    })

    it('keeps markerless legacy work unattributed even when the row has a marker', () => {
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            machineId: 'm-B',
            hostPid: 200,
            hostStartMarker: 'worker-B',
            unresolvedTurn: { since: NOW },
        } as Session['metadata'])
        expect(Object.keys(map)).toEqual([UNKNOWN_GENERATION_KEY])
        expect(map[UNKNOWN_GENERATION_KEY]?.hostPid).toBeUndefined()
        expect(map[UNKNOWN_GENERATION_KEY]?.machineId).toBe('')
        expect(generationEntryProbeClearable(
            session({ metadata: { path: '/tmp/p', host: 'h', startedBy: 'runner', machineId: 'm-B' } }),
            UNKNOWN_GENERATION_KEY,
            map[UNKNOWN_GENERATION_KEY]!,
        )).toBe(false)
    })

    it('projects legacy turn and background as separate owners when markers differ', () => {
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            machineId: 'm1',
            hostPid: 42,
            hostStartMarker: 'worker-A',
            unresolvedTurn: { since: NOW - 1000, hostStartMarker: 'worker-A' },
            backgroundWork: {
                tasks: [{ id: 'bg-1', type: 'local_bash', description: 'sleep' }],
                hostStartMarker: 'worker-B',
            },
        } as Session['metadata'])
        expect(map['worker-A']?.unresolvedTurn).toBe(true)
        expect(map['worker-A']?.backgroundTasks).toBeUndefined()
        expect(map['worker-B']?.backgroundTasks).toHaveLength(1)
        expect(map['worker-B']?.hostPid).toBeUndefined()
    })

    it('does not pair a prior legacy marker with the current row pid after replacement', () => {
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            machineId: 'm-B',
            hostPid: 200,
            hostStartMarker: 'worker-B',
            unresolvedTurn: { since: NOW - 1000, hostStartMarker: 'worker-A' },
        } as Session['metadata'])
        expect(Object.keys(map)).toEqual(['worker-A'])
        expect(map['worker-A']?.hostPid).toBeUndefined()
        expect(map['worker-A']?.machineId).toBe('')
        expect(generationEntryProbeClearable(
            session({ metadata: { path: '/tmp/p', host: 'h', startedBy: 'runner', machineId: 'm-B' } }),
            'worker-A',
            map['worker-A']!,
        )).toBe(false)
        expect(liveWorkByGenerationHasWork(map)).toBe(true)
    })

    it('prefers the keyed map when present (no legacy merge)', () => {
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 7, hostStartMarker: 'worker-B' })
        const map = projectLegacyLiveWork({
            path: '/tmp/p',
            host: 'h',
            liveWorkByGeneration: {
                [key]: {
                    machineId: 'm1',
                    hostPid: 7,
                    hostStartMarker: 'worker-B',
                    since: NOW,
                    unresolvedTurn: true,
                },
            },
            unresolvedTurn: { since: NOW, hostStartMarker: 'worker-A' },
        } as Session['metadata'])
        expect(Object.keys(map)).toEqual([key])
    })

    it('only marks runner-owned rows as probe-clearable when hostPid is present', () => {
        const runner = session({
            metadata: {
                path: '/tmp/p',
                host: 'h',
                startedBy: 'runner',
                machineId: 'm1',
            },
        })
        const terminal = session({
            metadata: {
                path: '/tmp/p',
                host: 'h',
                startedBy: 'terminal',
                machineId: 'm1',
            },
        })
        expect(isRunnerOwnedSession(runner)).toBe(true)
        expect(isRunnerOwnedSession(terminal)).toBe(false)
        const entry = {
            machineId: 'm1',
            hostPid: 99,
            hostStartMarker: 'worker-A',
            since: NOW,
            unresolvedTurn: true,
        }
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 99, hostStartMarker: 'worker-A' })
        expect(generationEntryProbeClearable(runner, key, entry)).toBe(true)
        // Entry ownership — a terminal resume must still probe prior runner work.
        expect(generationEntryProbeClearable(terminal, key, entry)).toBe(true)
        expect(generationEntryProbeClearable(runner, key, {
            machineId: 'm1',
            since: NOW,
            unresolvedTurn: true,
        })).toBe(false)
        expect(generationEntryHasWork({ machineId: 'm1', since: NOW })).toBe(false)
    })
})
