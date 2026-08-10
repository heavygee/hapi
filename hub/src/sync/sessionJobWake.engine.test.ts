import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { AttachedJobUpsert } from '@hapi/protocol'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'

function stubEngine(store: Store): SyncEngine {
    const engine = Object.create(SyncEngine.prototype) as SyncEngine
    ;(engine as unknown as { store: Store }).store = store
    const sessions = new Map<string, { id: string; namespace: string; active: boolean; metadata?: { flavor?: string; piSessionId?: string } }>()
    ;(engine as unknown as {
        sessionCache: {
            emitAttachedJobChanged: () => void
            getSession: (id: string) => { id: string; namespace: string; active: boolean; metadata?: { flavor?: string; piSessionId?: string } } | null
        }
    }).sessionCache = {
        emitAttachedJobChanged: () => undefined,
        getSession: (id) => sessions.get(id) ?? null,
    }
    ;(engine as unknown as { _sessions: typeof sessions })._sessions = sessions
    return engine
}

describe('SyncEngine job terminal wake scheduling (#1489 soup)', () => {
    afterEach(() => {
        mock.restore()
    })

    it('schedules resume+send once on terminal patch with wakeOnTerminal', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('wake-test', { path: '/tmp', flavor: 'cursor' }, null, 'default')

        const engine = stubEngine(store)
        const sessions = (engine as unknown as { _sessions: Map<string, { id: string; namespace: string; active: boolean }> })._sessions
        sessions.set(session.id, { id: session.id, namespace: 'default', active: false })

        const resumeCalls: string[] = []
        const sendCalls: Array<{ sessionId: string; text: string }> = []

        ;(engine as unknown as {
            resumeSession: (id: string, ns: string) => Promise<{ type: 'success'; sessionId: string }>
        }).resumeSession = async (id) => {
            resumeCalls.push(id)
            sessions.set(id, { id, namespace: 'default', active: true })
            return { type: 'success', sessionId: id }
        }
        ;(engine as unknown as {
            sendMessage: (id: string, payload: { text: string }) => Promise<void>
        }).sendMessage = async (id, payload) => {
            sendCalls.push({ sessionId: id, text: payload.text })
        }

        const body: AttachedJobUpsert = {
            label: 'batch',
            status: 'running',
            wakeOnTerminal: true,
            wakePrompt: 'Continue.',
            detail: 'chunk 1',
            startedAt: 42,
        }
        expect(engine.upsertSessionJob(session.id, 'batch', body).outcome).toBe('upserted')
        await Promise.resolve()
        expect(resumeCalls).toEqual([])
        expect(sendCalls).toEqual([])

        expect(engine.patchSessionJob(session.id, 'batch', {
            status: 'completed',
            detail: 'chunk 1 done',
        })).not.toBeNull()

        for (let i = 0; i < 20 && sendCalls.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 10))
        }

        expect(resumeCalls).toEqual([session.id])
        expect(sendCalls).toHaveLength(1)
        expect(sendCalls[0]!.text).toContain('status=completed')
        expect(sendCalls[0]!.text).toContain('Continue.')

        engine.patchSessionJob(session.id, 'batch', { status: 'completed' })
        await new Promise((r) => setTimeout(r, 50))
        expect(sendCalls).toHaveLength(1)
        store.close()
    })
})
