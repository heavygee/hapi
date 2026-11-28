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
    it('projects legacy single-slot latches into an owner key when pid is known', () => {
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
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 42, hostStartMarker: 'worker-A' })
        expect(Object.keys(map)).toEqual([key])
        expect(map[key]?.unresolvedTurn).toBe(true)
        expect(map[key]?.backgroundTasks).toHaveLength(1)
        expect(map[key]?.hostPid).toBe(42)
        expect(map[key]?.machineId).toBe('m1')
        expect(map[key]?.hostStartMarker).toBe('worker-A')
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
        expect(generationEntryProbeClearable(terminal, key, entry)).toBe(false)
        expect(generationEntryProbeClearable(runner, key, {
            machineId: 'm1',
            since: NOW,
            unresolvedTurn: true,
        })).toBe(false)
        expect(generationEntryHasWork({ machineId: 'm1', since: NOW })).toBe(false)
    })
})
