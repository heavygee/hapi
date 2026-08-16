import { describe, expect, it } from 'vitest'
import { toSessionSummary, type Session } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import {
    deduplicateSessionsByAgentId,
    expandSelectedSessionCollapseOverrides,
    filterActiveSessionsOnly,
    filterUnreadSessionsOnly,
    UNKNOWN_MACHINE_ID,
    getSessionTimeRange,
    getNextSessionVisibleCount,
    getPullRefreshIndicatorRotation,
    getPreviousSessionVisibleCount,
    getPullToRefreshState,
    getSessionDedupKey,
    getWorktreeSessionLabel,
    getVisibleSessionPreview,
    isSidebarEmptySessionStub,
    normalizeSearch,
    prepareSidebarSessions,
    sessionListItemButtonClassName,
    sessionListItemWrapperClassName,
    sessionMatchesQuery,
    sessionMatchesTimeRange,
    shouldShowSessionInSidebar,
    partitionGlobalPinnedSessions,
    sortGlobalPinnedSessions
} from './SessionList'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        attachedJob: null,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('getWorktreeSessionLabel', () => {
    it('returns the worktree name for sessions grouped under a shared repository', () => {
        const session = makeSession({
            id: 'worktree-session',
            metadata: {
                path: '/work/hapi-worktrees/fix-resume',
                worktree: {
                    basePath: '/work/hapi',
                    branch: 'fix/resume',
                    name: 'fix-resume',
                    worktreePath: '/work/hapi-worktrees/fix-resume'
                }
            }
        })

        expect(getWorktreeSessionLabel(session)).toBe('fix-resume')
    })

    it('does not add a subtitle to ordinary sessions', () => {
        const session = makeSession({
            id: 'ordinary-session',
            metadata: { path: '/work/hapi' }
        })

        expect(getWorktreeSessionLabel(session)).toBeNull()
    })

    it('falls back to the worktree directory name when metadata name is blank', () => {
        const session = makeSession({
            id: 'windows-worktree-session',
            metadata: {
                path: 'C:\\work\\hapi-worktrees\\fix-resume',
                worktree: {
                    basePath: 'C:\\work\\hapi',
                    branch: 'fix/resume',
                    name: '   ',
                    worktreePath: 'C:\\work\\hapi-worktrees\\fix-resume\\'
                }
            }
        })

        expect(getWorktreeSessionLabel(session)).toBe('fix-resume')
    })
})

describe('partitionGlobalPinnedSessions', () => {
    it('lifts pinned sessions into a flat top band and omits them from the remainder', () => {
        const sessions = [
            makeSession({ id: 'proj-a', metadata: { path: '/a' }, updatedAt: 50 }),
            makeSession({ id: 'pinned-old', globalPinned: true, metadata: { path: '/b' }, updatedAt: 10 }),
            makeSession({ id: 'pinned-new', globalPinned: true, active: true, metadata: { path: '/c' }, updatedAt: 20 }),
            makeSession({ id: 'proj-b', metadata: { path: '/b' }, updatedAt: 40 })
        ]

        const { pinned, unpinned } = partitionGlobalPinnedSessions(sessions)
        expect(pinned.map(session => session.id)).toEqual(['pinned-new', 'pinned-old'])
        expect(unpinned.map(session => session.id)).toEqual(['proj-a', 'proj-b'])
    })

    it('sorts pending pinned sessions ahead of quiet active pins', () => {
        const sessions = [
            makeSession({ id: 'quiet', globalPinned: true, active: true, pendingRequestsCount: 0, updatedAt: 100 }),
            makeSession({ id: 'pending', globalPinned: true, active: true, pendingRequestsCount: 2, updatedAt: 50 })
        ]
        expect(sortGlobalPinnedSessions(sessions).map(session => session.id))
            .toEqual(['pending', 'quiet'])
    })
})

describe('deduplicateSessionsByAgentId', () => {
    it('deduplicates sessions with the same agentSessionId', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'b', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('b') // more recent wins
    })

    it('keeps active session over inactive duplicate', () => {
        const sessions = [
            makeSession({ id: 'a', active: true, metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'b', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('a') // active wins despite older updatedAt
    })

    it('prefers selected session among inactive duplicates', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'b', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions, 'a')
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('a') // selected wins despite older updatedAt
    })

    it('preserves a pinned session when deduplicating by recency', () => {
        const sessions = [
            makeSession({ id: 'pinned', pinned: true, metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'recent', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('pinned')
    })

    it('keeps the selected inactive session ahead of a pinned duplicate', () => {
        const sessions = [
            makeSession({ id: 'selected', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'pinned', pinned: true, metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions, 'selected')
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('selected')
    })

    it('active always wins over selected inactive', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 }),
            makeSession({ id: 'b', active: true, metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 })
        ]
        const result = deduplicateSessionsByAgentId(sessions, 'a')
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('b') // active wins over selected
    })

    it('passes through sessions without agentSessionId', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/p' } }),
            makeSession({ id: 'b', metadata: { path: '/p', agentSessionId: 'thread-1' } }),
            makeSession({ id: 'c', metadata: null })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(3)
    })

    it('deduplicates cursor sessions by summary agentSessionId', () => {
        const sessions = [
            makeSession({
                id: 'a',
                active: true,
                metadata: { path: '/p', flavor: 'cursor', agentSessionId: 'acp-thread-1' },
                updatedAt: 100
            }),
            makeSession({
                id: 'b',
                metadata: { path: '/p', flavor: 'cursor', agentSessionId: 'acp-thread-1' },
                updatedAt: 200
            })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('a')
    })

    it('deduplicates independently across different agentSessionIds', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 100 }),
            makeSession({ id: 'b', metadata: { path: '/p', agentSessionId: 'thread-1' }, updatedAt: 200 }),
            makeSession({ id: 'c', metadata: { path: '/p', agentSessionId: 'thread-2' }, updatedAt: 100 }),
            makeSession({ id: 'd', metadata: { path: '/p', agentSessionId: 'thread-2' }, updatedAt: 200 })
        ]
        const result = deduplicateSessionsByAgentId(sessions)
        expect(result).toHaveLength(2)
        expect(result.map(s => s.id).sort()).toEqual(['b', 'd'])
    })

    it('does not dedupe across flavors sharing the same flattened agentSessionId', () => {
        const sessions = [
            makeSession({
                id: 'codex',
                metadata: { path: '/p', flavor: 'codex', agentSessionId: 'stale-shared-id' },
                updatedAt: 100
            }),
            makeSession({
                id: 'cursor',
                metadata: { path: '/p', flavor: 'cursor', agentSessionId: 'stale-shared-id' },
                updatedAt: 200
            })
        ]

        expect(getSessionDedupKey(sessions[0])).toBe('codex:stale-shared-id')
        expect(getSessionDedupKey(sessions[1])).toBe('cursor:stale-shared-id')
        expect(deduplicateSessionsByAgentId(sessions).map(session => session.id).sort()).toEqual(['codex', 'cursor'])
        expect(prepareSidebarSessions(sessions).map(session => session.id).sort()).toEqual(['codex', 'cursor'])
    })
})


describe('isSidebarEmptySessionStub', () => {
    it('treats inactive sessions without agent id or title as stubs', () => {
        expect(isSidebarEmptySessionStub(makeSession({
            id: 'stub',
            metadata: { path: '/work/hapi' }
        }))).toBe(true)
    })

    it('does not treat active sessions as stubs', () => {
        expect(isSidebarEmptySessionStub(makeSession({
            id: 'live',
            active: true,
            metadata: { path: '/work/hapi' }
        }))).toBe(false)
    })

    it('does not treat sessions with agentSessionId as stubs', () => {
        expect(isSidebarEmptySessionStub(makeSession({
            id: 'resume',
            metadata: { path: '/work/hapi', agentSessionId: 'thread-1' }
        }))).toBe(false)
    })

    it('does not treat sessions with summary text as stubs', () => {
        expect(isSidebarEmptySessionStub(makeSession({
            id: 'titled',
            metadata: { path: '/work/hapi', summary: { text: 'Fix sidebar' } }
        }))).toBe(false)
    })
})

describe('prepareSidebarSessions', () => {
    it('hides inactive empty stubs but keeps real sessions', () => {
        const sessions = [
            makeSession({ id: 'stub', metadata: { path: '/work/hapi' } }),
            makeSession({
                id: 'real',
                metadata: { path: '/work/hapi', agentSessionId: 'thread-1', summary: { text: 'Real chat' } }
            })
        ]

        const result = prepareSidebarSessions(sessions)
        expect(result.map(session => session.id)).toEqual(['real'])
    })

    it('keeps an archived Pi session with a native session id and no title', () => {
        const piSession: Session = {
            id: 'archived-pi',
            namespace: 'default',
            seq: 1,
            createdAt: 50,
            active: false,
            activeAt: 0,
            updatedAt: 100,
            metadata: {
                path: '/work/hapi',
                host: 'local',
                flavor: 'pi',
                piSessionId: 'pi-session-1',
                lifecycleState: 'archived'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            model: null,
            modelReasoningEffort: null,
            effort: null,
            serviceTier: null
        }

        const summary = toSessionSummary(piSession)

        expect(summary.metadata?.agentSessionId).toBe('pi-session-1')
        expect(prepareSidebarSessions([summary]).map(session => session.id)).toEqual(['archived-pi'])
    })

    it('keeps the selected inactive stub visible', () => {
        const sessions = [
            makeSession({ id: 'stub', metadata: { path: '/work/hapi' } }),
            makeSession({
                id: 'real',
                metadata: { path: '/work/hapi', agentSessionId: 'thread-1' }
            })
        ]

        const result = prepareSidebarSessions(sessions, 'stub')
        expect(result.map(session => session.id).sort()).toEqual(['real', 'stub'])
    })

    it('keeps a pinned inactive stub visible', () => {
        const sessions = [
            makeSession({ id: 'pinned-stub', pinned: true, metadata: { path: '/work/hapi' } }),
            makeSession({ id: 'stub', metadata: { path: '/work/hapi' } })
        ]

        const result = prepareSidebarSessions(sessions)
        expect(result.map(session => session.id)).toEqual(['pinned-stub'])
    })

    it('deduplicates before filtering stubs', () => {
        const sessions = [
            makeSession({ id: 'stub', metadata: { path: '/work/hapi' } }),
            makeSession({
                id: 'older',
                metadata: { path: '/work/hapi', agentSessionId: 'thread-1' },
                updatedAt: 100
            }),
            makeSession({
                id: 'newer',
                metadata: { path: '/work/hapi', agentSessionId: 'thread-1' },
                updatedAt: 200
            })
        ]

        const result = prepareSidebarSessions(sessions)
        expect(result.map(session => session.id)).toEqual(['newer'])
    })
})

describe('shouldShowSessionInSidebar', () => {
    it('always shows active, selected, and pinned sessions', () => {
        const stub = makeSession({ id: 'stub', metadata: { path: '/work/hapi' } })
        expect(shouldShowSessionInSidebar(stub)).toBe(false)
        expect(shouldShowSessionInSidebar(stub, 'stub')).toBe(true)
        expect(shouldShowSessionInSidebar({ ...stub, active: true })).toBe(true)
        expect(shouldShowSessionInSidebar({ ...stub, pinned: true })).toBe(true)
    })
})

describe('session list search helpers', () => {
    it('normalizes whitespace and case before filtering', () => {
        const session = makeSession({
            id: 'session-1',
            metadata: {
                path: '/work/hapi',
                name: 'Fix Bot Review',
                flavor: 'codex',
                machineId: 'machine-1'
            }
        })

        expect(normalizeSearch('  BOT  ')).toBe('bot')
        expect(sessionMatchesQuery(session, normalizeSearch('bot review'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('desktop'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('missing'), 'desktop')).toBe(false)
    })

    it('matches the displayed worktree label and worktree path', () => {
        const session = makeSession({
            id: 'worktree-session',
            metadata: {
                path: '/work/hapi',
                worktree: {
                    basePath: '/work/hapi',
                    branch: 'fix/sidebar-search',
                    name: 'sidebar-search',
                    worktreePath: '/work/hapi-worktrees/fix-sidebar-search'
                }
            }
        })

        expect(sessionMatchesQuery(session, normalizeSearch('sidebar-search'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('hapi-worktrees'), 'desktop')).toBe(true)
    })

    it('supports complete wildcard patterns without changing plain text matching', () => {
        const session = makeSession({
            id: 'session-123',
            metadata: {
                path: '/work/hapi',
                name: 'Fix Bot Review',
                flavor: 'codex'
            }
        })

        expect(sessionMatchesQuery(session, normalizeSearch('*bot*'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('Fix*Review'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('session-???'), 'desktop')).toBe(true)
        expect(sessionMatchesQuery(session, normalizeSearch('bot*review'), 'desktop')).toBe(false)
        expect(sessionMatchesQuery(session, normalizeSearch('bot review'), 'desktop')).toBe(true)
    })
})

describe('session list time filter helpers', () => {
    it('treats the selected end date as inclusive in local time', () => {
        const range = getSessionTimeRange('2026-07-01', '2026-07-18')
        expect(range).toEqual({
            start: new Date(2026, 6, 1).getTime(),
            end: new Date(2026, 6, 19).getTime()
        })
        expect(sessionMatchesTimeRange(makeSession({ id: 'inside', updatedAt: new Date(2026, 6, 18, 23, 59).getTime() }), range)).toBe(true)
        expect(sessionMatchesTimeRange(makeSession({ id: 'outside', updatedAt: new Date(2026, 6, 19).getTime() }), range)).toBe(false)
    })

    it('does not filter until both dates are selected', () => {
        expect(getSessionTimeRange('', '')).toBeNull()
        expect(getSessionTimeRange('2026-07-01', '')).toBeNull()
    })
})

describe('getVisibleSessionPreview', () => {
    it('keeps selected and pending sessions inside the collapsed preview without promoting them', () => {
        const sessions = Array.from({ length: 6 }, (_, index) => makeSession({
            id: `s-${index + 1}`,
            pendingRequestsCount: index === 4 ? 1 : 0,
            metadata: { path: '/work/hapi' },
            updatedAt: 100 - index
        }))

        const preview = getVisibleSessionPreview(sessions, {
            selectedSessionId: 's-6',
            limit: 3
        })

        expect(preview.map(session => session.id)).toEqual(['s-1', 's-5', 's-6'])
    })

    it('does not exceed the limit just because many sessions are active', () => {
        const sessions = Array.from({ length: 6 }, (_, index) => makeSession({
            id: `s-${index + 1}`,
            active: true,
            metadata: { path: '/work/hapi' },
            updatedAt: 100 - index
        }))

        const preview = getVisibleSessionPreview(sessions, { limit: 4 })

        expect(preview.map(session => session.id)).toEqual(['s-1', 's-2', 's-3', 's-4'])
    })

    it('does not move an already-visible selected session to the top', () => {
        const sessions = Array.from({ length: 6 }, (_, index) => makeSession({
            id: `s-${index + 1}`,
            metadata: { path: '/work/hapi' },
            updatedAt: 100 - index
        }))

        const preview = getVisibleSessionPreview(sessions, {
            selectedSessionId: 's-3',
            limit: 4
        })

        expect(preview.map(session => session.id)).toEqual(['s-1', 's-2', 's-3', 's-4'])
    })

    it('returns all sessions when expanded', () => {
        const sessions = Array.from({ length: 4 }, (_, index) => makeSession({
            id: `s-${index + 1}`,
            metadata: { path: '/work/hapi' }
        }))

        expect(getVisibleSessionPreview(sessions, { expanded: true, limit: 2 })).toHaveLength(4)
    })
})


describe('filterActiveSessionsOnly', () => {
    it('keeps only active sessions when no selection', () => {
        const sessions = [
            makeSession({ id: 'live', active: true, metadata: { path: '/p' } }),
            makeSession({ id: 'dead', metadata: { path: '/p' } })
        ]
        expect(filterActiveSessionsOnly(sessions).map(s => s.id)).toEqual(['live'])
    })

    it('keeps the selected inactive session visible', () => {
        const sessions = [
            makeSession({ id: 'live', active: true, metadata: { path: '/p' } }),
            makeSession({ id: 'dead', metadata: { path: '/p' } }),
            makeSession({ id: 'selected-dead', metadata: { path: '/p' } })
        ]
        expect(filterActiveSessionsOnly(sessions, 'selected-dead').map(s => s.id).sort())
            .toEqual(['live', 'selected-dead'])
    })

    it('preserves input order', () => {
        const sessions = [
            makeSession({ id: 'a', active: true, metadata: { path: '/p' } }),
            makeSession({ id: 'b', metadata: { path: '/p' } }),
            makeSession({ id: 'c', active: true, metadata: { path: '/p' } })
        ]
        expect(filterActiveSessionsOnly(sessions).map(s => s.id)).toEqual(['a', 'c'])
    })
})

describe('filterUnreadSessionsOnly', () => {
    const lastSeen = (id: string): number => {
        if (id === 'unread') return 1000
        return 10_000
    }

    it('keeps only sessions newer than lastSeen; drops seen and selected-only quiet rows stay when selected', () => {
        const sessions = [
            makeSession({ id: 'unread', updatedAt: 5000, metadata: { path: '/p' } }),
            makeSession({ id: 'seen', updatedAt: 1000, metadata: { path: '/p' } }),
            makeSession({
                id: 'permission-but-seen',
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 1000,
                metadata: { path: '/p' },
            }),
        ]
        expect(filterUnreadSessionsOnly(sessions, null, lastSeen).map(s => s.id))
            .toEqual(['unread'])
    })

    it('keeps the selected session visible even when it would otherwise filter out', () => {
        const sessions = [
            makeSession({ id: 'unread', updatedAt: 5000, metadata: { path: '/p' } }),
            makeSession({ id: 'selected-quiet', updatedAt: 1000, metadata: { path: '/p' } }),
        ]
        expect(filterUnreadSessionsOnly(sessions, 'selected-quiet', lastSeen).map(s => s.id))
            .toEqual(['unread', 'selected-quiet'])
    })

    it('composes with machine filter as empty intersection (unread after machine scope stays selected)', () => {
        // Mirrors SessionList pipeline: unread on visibleSessions, then machine filter.
        // Machine B selected + only machine A unread → empty list, not "all unread".
        const sessions = [
            makeSession({
                id: 'unread-a',
                updatedAt: 5000,
                metadata: { path: '/a', machineId: 'machine-a' },
            }),
            makeSession({
                id: 'seen-b',
                updatedAt: 1000,
                metadata: { path: '/b', machineId: 'machine-b' },
            }),
        ]
        const lastSeenById = (id: string) => (id === 'unread-a' ? 0 : 10_000)
        const unreadFiltered = filterUnreadSessionsOnly(sessions, null, lastSeenById)
        const machineB = unreadFiltered.filter(
            session => (session.metadata?.machineId ?? UNKNOWN_MACHINE_ID) === 'machine-b'
        )
        expect(unreadFiltered.map(s => s.id)).toEqual(['unread-a'])
        expect(machineB).toEqual([])
    })
})

describe('getNextSessionVisibleCount', () => {
    it('reveals one batch of step size per call', () => {
        expect(getNextSessionVisibleCount(8, 8, 20)).toBe(16)
        expect(getNextSessionVisibleCount(16, 8, 20)).toBe(20)
    })

    it('never exceeds the total session count', () => {
        expect(getNextSessionVisibleCount(18, 8, 20)).toBe(20)
        expect(getNextSessionVisibleCount(20, 8, 20)).toBe(20)
    })

    it('always advances by at least one even with a zero step', () => {
        expect(getNextSessionVisibleCount(5, 0, 20)).toBe(6)
    })
})

describe('getPreviousSessionVisibleCount', () => {
    it('collapses one batch of step size per call', () => {
        expect(getPreviousSessionVisibleCount(20, 8)).toBe(12)
        expect(getPreviousSessionVisibleCount(12, 8)).toBe(8)
    })

    it('never goes below the preview limit', () => {
        expect(getPreviousSessionVisibleCount(10, 8)).toBe(8)
        expect(getPreviousSessionVisibleCount(8, 8)).toBe(8)
    })

    it('uses a minimum batch size of one', () => {
        expect(getPreviousSessionVisibleCount(5, 0)).toBe(4)
    })
})

describe('expandSelectedSessionCollapseOverrides', () => {
    it('expands collapsed project and machine, but preserves session preview folding', () => {
        const overrides = new Map<string, boolean>([
            ['machine-1::/work/hapi', true],
            ['sessions::machine-1::/work/hapi', true],
            ['machine::machine-1', true]
        ])

        const result = expandSelectedSessionCollapseOverrides(overrides, {
            key: 'machine-1::/work/hapi'
        })

        // Only the selected project path is forced open; session-preview and
        // machine collapses stay under operator control (unread/pin soup).
        expect(result.get('machine-1::/work/hapi')).toBe(false)
        expect(result.get('sessions::machine-1::/work/hapi')).toBe(true)
        expect(result.get('machine::machine-1')).toBe(true)
    })

    it('leaves missing session preview override unset', () => {
        const overrides = new Map<string, boolean>()

        const result = expandSelectedSessionCollapseOverrides(overrides, {
            key: 'machine-1::/work/hapi'
        })

        expect(result.has('sessions::machine-1::/work/hapi')).toBe(false)
    })
})

describe('getPullToRefreshState', () => {
    it('requires a deliberate pull past the trigger distance', () => {
        expect(getPullToRefreshState(15)).toBe('idle')
        expect(getPullToRefreshState(16)).toBe('pulling')
        expect(getPullToRefreshState(63)).toBe('pulling')
        expect(getPullToRefreshState(64)).toBe('ready')
    })
})

describe('getPullRefreshIndicatorRotation', () => {
    it('turns the pull indicator upward once refresh is ready', () => {
        expect(getPullRefreshIndicatorRotation('pulling')).toBe(0)
        expect(getPullRefreshIndicatorRotation('ready')).toBe(180)
    })
})

describe('session list row focus group classes', () => {
    it('puts group/session-row on the focusable button, not the wrapper', () => {
        expect(sessionListItemButtonClassName()).toContain('group/session-row')
        expect(sessionListItemWrapperClassName(false)).not.toContain('group/session-row')
        expect(sessionListItemWrapperClassName(true)).toContain('bg-[var(--app-secondary-bg)]')
        expect(sessionListItemWrapperClassName(true)).not.toContain('group/session-row')
    })
})
