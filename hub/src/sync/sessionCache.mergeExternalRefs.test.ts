import { describe, expect, it } from 'bun:test'
import {
    mergeSessionMetadataForSessionMerge,
    transferSourceLiveWorkOntoDest,
    unionLiveWorkByGeneration,
} from './sessionCache'
import { liveWorkOwnerKey } from './liveWorkByGeneration'

const prRef = {
    kind: 'github_pr' as const,
    repo: 'tiann/hapi',
    number: 1160,
    url: 'https://github.com/tiann/hapi/pull/1160',
    role: 'primary' as const
}

describe('mergeSessionMetadataForSessionMerge externalRefs', () => {
    it('preserves externalRefs from the old row when the new row omits them', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            name: 'PR session',
            externalRefs: [prRef]
        }
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            flavor: 'cursor'
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        expect(merged.externalRefs).toEqual([prRef])
        expect(merged.path).toBe('/new')
        expect(merged.flavor).toBe('cursor')
        expect(merged.name).toBe('PR session')
    })

    it('lets the new row win when it explicitly sets externalRefs', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            externalRefs: [prRef]
        }
        const replacement = [{
            kind: 'github_pr' as const,
            repo: 'owner/other',
            number: 42,
            url: 'https://github.com/owner/other/pull/42',
            role: 'primary' as const
        }]
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            externalRefs: replacement
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        expect(merged.externalRefs).toEqual(replacement)
    })

    it('lets an explicit empty externalRefs array clear the old refs', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            externalRefs: [prRef]
        }
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            externalRefs: []
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        expect(merged.externalRefs).toEqual([])
    })

    it('keeps liveWorkByGeneration out of early metadata merges (#2658)', () => {
        const priorKey = liveWorkOwnerKey({ machineId: 'm-A', hostPid: 11, hostStartMarker: 'worker-A' })
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            liveWorkByGeneration: {
                [priorKey]: {
                    machineId: 'm-A',
                    hostPid: 11,
                    hostStartMarker: 'worker-A',
                    since: 1_000,
                    unresolvedTurn: true,
                },
            },
        }
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            hostStartMarker: 'worker-B',
            hostPid: 22,
            machineId: 'm-B',
        }

        // Deleting merges transfer fresh snapshots immediately before source
        // deletion — early/history-only metadata merges must not copy the map.
        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>
        expect(merged.liveWorkByGeneration).toBeUndefined()
    })

    it('unions overlapping generation entries without dropping work bits', () => {
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 7, hostStartMarker: 'w' })
        const united = unionLiveWorkByGeneration(
            {
                [key]: {
                    machineId: 'm1',
                    hostPid: 7,
                    hostStartMarker: 'w',
                    since: 10,
                    unresolvedTurn: true,
                },
            },
            {
                [key]: {
                    machineId: 'm1',
                    hostPid: 7,
                    hostStartMarker: 'w',
                    since: 20,
                    backgroundTasks: [{ id: 'bg-1', type: 'local_bash', description: 'sleep' }],
                },
            },
        )
        expect(united[key]?.unresolvedTurn).toBe(true)
        expect(united[key]?.backgroundTasks).toHaveLength(1)
        expect(united[key]?.since).toBe(10)
    })

    it('drops a stale first-merge source copy when the fresh source is idle', () => {
        const keyA = liveWorkOwnerKey({ machineId: 'm1', hostPid: 1, hostStartMarker: 'A' })
        const keyB = liveWorkOwnerKey({ machineId: 'm1', hostPid: 2, hostStartMarker: 'B' })
        const initialA = {
            machineId: 'm1',
            hostPid: 1,
            hostStartMarker: 'A',
            since: 10,
            unresolvedTurn: true as const,
        }
        const dest = {
            [keyA]: { ...initialA },
            [keyB]: {
                machineId: 'm1',
                hostPid: 2,
                hostStartMarker: 'B',
                since: 20,
                backgroundTasks: [{ id: 'bg-b', type: 'local_bash', description: 'b' }],
            },
        }
        const transferred = transferSourceLiveWorkOntoDest(
            dest,
            {},
            new Set([keyA]),
            { [keyA]: initialA },
        )
        expect(transferred[keyA]).toBeUndefined()
        expect(transferred[keyB]?.backgroundTasks).toHaveLength(1)
    })

    it('unions overlapping owners on final transfer instead of replacing dest', () => {
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 1, hostStartMarker: 'shared' })
        const transferred = transferSourceLiveWorkOntoDest(
            {
                [key]: {
                    machineId: 'm1',
                    hostPid: 1,
                    hostStartMarker: 'shared',
                    since: 20,
                    backgroundTasks: [{ id: 'bg', type: 'local_bash', description: 'dest' }],
                },
            },
            {
                [key]: {
                    machineId: 'm1',
                    hostPid: 1,
                    hostStartMarker: 'shared',
                    since: 10,
                    unresolvedTurn: true,
                },
            },
            new Set([key]),
        )
        expect(transferred[key]?.unresolvedTurn).toBe(true)
        expect(transferred[key]?.backgroundTasks).toHaveLength(1)
    })

    it('strips settled source unresolvedTurn from a combined dest entry (#2658)', () => {
        const key = liveWorkOwnerKey({ machineId: 'm1', hostPid: 1, hostStartMarker: 'shared' })
        const initialSource = {
            [key]: {
                machineId: 'm1',
                hostPid: 1,
                hostStartMarker: 'shared',
                since: 10,
                unresolvedTurn: true as const,
            },
        }
        // First merge already combined source turn + dest background.
        const destAfterFirstMerge = {
            [key]: {
                machineId: 'm1',
                hostPid: 1,
                hostStartMarker: 'shared',
                since: 10,
                unresolvedTurn: true as const,
                backgroundTasks: [{ id: 'bg', type: 'local_bash', description: 'dest' }],
            },
        }
        // Source settled during I/O — owner key gone from the final snapshot.
        const transferred = transferSourceLiveWorkOntoDest(
            destAfterFirstMerge,
            {},
            new Set([key]),
            initialSource,
        )
        expect(transferred[key]?.unresolvedTurn).toBeUndefined()
        expect(transferred[key]?.backgroundTasks).toHaveLength(1)
    })
})
