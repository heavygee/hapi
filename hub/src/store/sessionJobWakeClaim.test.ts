import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('session job terminal wake claim (#1489 soup)', () => {
    it('ensures wake columns on open', () => {
        const store = new Store(':memory:')
        const cols = (store as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ name: string }> } } })
            .db.prepare('PRAGMA table_info(session_jobs)').all().map((r) => r.name)
        expect(cols).toContain('wake_on_terminal')
        expect(cols).toContain('wake_prompt')
        expect(cols).toContain('wake_emitted_run_id')
        store.close()
    })

    it('claims wake once per startedAt generation on terminal + opt-in', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')

        store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            wakeOnTerminal: true,
            wakePrompt: 'Next batch please.',
            detail: 'album: 1',
            startedAt: 1000,
        })
        expect(store.sessionJobs.claimTerminalWake(session.id, 'beets')).toBeNull()

        store.sessionJobs.patch(session.id, 'beets', {
            status: 'completed',
            detail: 'album: done',
        })
        const first = store.sessionJobs.claimTerminalWake(session.id, 'beets')
        expect(first).not.toBeNull()
        expect(first?.wakeEmittedRunId).toBe('norun:1000')
        expect(store.sessionJobs.claimTerminalWake(session.id, 'beets')).toBeNull()

        // New generation via startedAt clears claim.
        store.sessionJobs.upsert(session.id, 'beets', {
            label: 'beets import',
            status: 'running',
            wakeOnTerminal: true,
            startedAt: 2000,
        })
        store.sessionJobs.patch(session.id, 'beets', { status: 'failed' })
        const third = store.sessionJobs.claimTerminalWake(session.id, 'beets')
        expect(third?.wakeEmittedRunId).toBe('norun:2000')
        expect(third?.status).toBe('failed')
        store.close()
    })

    it('does not claim when wakeOnTerminal is off', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('test', { path: '/tmp' }, null, 'default')
        store.sessionJobs.upsert(session.id, 'x', {
            label: 'x',
            status: 'completed',
            wakeOnTerminal: false,
        })
        expect(store.sessionJobs.claimTerminalWake(session.id, 'x')).toBeNull()
        store.close()
    })
})
