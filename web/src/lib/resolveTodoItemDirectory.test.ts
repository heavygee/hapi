import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { resolveTodoItemDirectory } from './resolveTodoItemDirectory'

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
        model: null,
        effort: null,
        ...overrides
    }
}

describe('resolveTodoItemDirectory', () => {
    it('returns null when the item has no repo', () => {
        expect(resolveTodoItemDirectory(null, [])).toBeNull()
    })

    it('returns null when no known directory matches the repo name', () => {
        const sessions = [makeSession({ id: 's1', metadata: { path: '/home/user/some-other-project', machineId: 'm1' } })]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toBeNull()
    })

    it('resolves a single matching directory by its final path segment', () => {
        const sessions = [makeSession({ id: 's1', metadata: { path: '/home/user/hapi-demo-board', machineId: 'machine-1' } })]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toEqual({
            directory: '/home/user/hapi-demo-board',
            machineId: 'machine-1'
        })
    })

    it('matches case-insensitively', () => {
        const sessions = [makeSession({ id: 's1', metadata: { path: '/home/user/Hapi-Demo-Board', machineId: 'm1' } })]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toEqual({
            directory: '/home/user/Hapi-Demo-Board',
            machineId: 'm1'
        })
    })

    it('treats a matching directory with an unknown machine as no match, not a guess with a null machineId', () => {
        // A directory/machine mismatch (NewSession auto-picking an unrelated
        // host while initialDirectory still points at a real path elsewhere)
        // is worse than just leaving the form blank.
        const sessions = [makeSession({ id: 's1', metadata: { path: '/home/user/hapi-demo-board' } })]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toBeNull()
    })

    it('picks the most recently active directory when multiple match', () => {
        const sessions = [
            makeSession({ id: 'old', metadata: { path: '/home/user/hapi-demo-board', machineId: 'm1' }, updatedAt: 100 }),
            makeSession({ id: 'new', metadata: { path: '/srv/worktrees/hapi-demo-board', machineId: 'm2' }, updatedAt: 999 }),
        ]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toEqual({
            directory: '/srv/worktrees/hapi-demo-board',
            machineId: 'm2'
        })
    })

    it('prefers a worktree basePath over the session path, same as session grouping', () => {
        const sessions = [makeSession({
            id: 's1',
            metadata: {
                path: '/home/user/some-checkout-dir',
                machineId: 'm1',
                worktree: { basePath: '/home/user/hapi-demo-board', branch: 'main', name: 'hapi-demo-board' }
            }
        })]
        expect(resolveTodoItemDirectory('heavygee/hapi-demo-board', sessions)).toEqual({
            directory: '/home/user/hapi-demo-board',
            machineId: 'm1'
        })
    })
})
