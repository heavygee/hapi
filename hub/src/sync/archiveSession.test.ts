import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { RpcTargetMissingError } from './rpcGateway'
import { SyncEngine } from './syncEngine'

type StopStatus = 'stopped' | 'already_gone' | 'still_alive'

type RpcGatewayStub = {
    killSession: (sessionId: string) => Promise<void>
    stopRunnerSession: (machineId: string, sessionId: string) => Promise<StopStatus>
}

function gateway(engine: SyncEngine): RpcGatewayStub {
    return (engine as unknown as { rpcGateway: RpcGatewayStub }).rpcGateway
}

function createIo(rooms = new Map<string, Set<string>>()) {
    return {
        of() {
            return {
                adapter: { rooms },
                to() {
                    return { emit() {} }
                }
            }
        }
    } as never
}

function createEngine(rooms = new Map<string, Set<string>>()) {
    const store = new Store(':memory:')
    const engine = new SyncEngine(store, createIo(rooms), new RpcRegistry(), { broadcast() {} } as never)
    return { store, engine, rooms }
}

function seedActiveSession(
    engine: SyncEngine,
    tag: string,
    metadata: { machineId?: string } = {}
) {
    const session = engine.getOrCreateSession(
        tag,
        {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex',
            ...metadata
        },
        null,
        'default'
    )
    engine.handleSessionAlive({ sid: session.id, time: Date.now() })
    return session
}

function missingKill(sessionId: string) {
    return new RpcTargetMissingError(`${sessionId}:killSession`, 'handler-not-registered')
}

function missingStop(machineId: string) {
    return new RpcTargetMissingError(`${machineId}:stopSession`, 'handler-not-registered')
}

describe('archiveSession (#1203 in-flight CLI)', () => {
    it('archives when KillSession succeeds and does not call StopSession', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'kill-ok', { machineId: 'machine-1' })
            const stops: string[] = []
            const rpc = gateway(engine)
            rpc.killSession = async () => {}
            rpc.stopRunnerSession = async (_machineId, sessionId) => {
                stops.push(sessionId)
                return 'stopped'
            }

            await engine.archiveSession(session.id)

            expect(engine.getSessionByNamespace(session.id, 'default')?.active).toBe(false)
            expect(stops).toEqual([])
        } finally {
            engine.stop()
        }
    })

    it('falls back to runner StopSession when KillSession is missing', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'stop-ok', { machineId: 'machine-1' })
            const stops: Array<[string, string]> = []
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async (machineId, sessionId) => {
                stops.push([machineId, sessionId])
                return 'stopped'
            }

            await engine.archiveSession(session.id)

            expect(stops).toEqual([['machine-1', session.id]])
            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(false)
            expect(row?.metadata?.lifecycleState).toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('refuses to archive when the runner says the process is still alive', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'still-alive', { machineId: 'machine-1' })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async () => 'still_alive'

            await expect(engine.archiveSession(session.id)).rejects.toThrow(/not controllable/)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(true)
            expect(row?.metadata?.lifecycleState).not.toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('refuses to archive when StopSession is already_gone but a CLI socket is still in the room', async () => {
        const { engine, rooms } = createEngine()
        try {
            const session = seedActiveSession(engine, 'zombie-socket', { machineId: 'machine-1' })
            rooms.set(`session:${session.id}`, new Set(['sock-1']))
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async () => 'already_gone'

            await expect(engine.archiveSession(session.id)).rejects.toThrow(/not controllable/)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(true)
            expect(row?.metadata?.lifecycleState).not.toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('archives the classic #916 case: no kill handler, runner already_gone, no live socket', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'truly-gone', { machineId: 'machine-1' })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async () => 'already_gone'

            await engine.archiveSession(session.id)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(false)
            expect(row?.metadata?.lifecycleState).toBe('archived')
            expect(row?.metadata?.archiveReason).toBe('Archived from hub (CLI unreachable)')
        } finally {
            engine.stop()
        }
    })

    it('refuses to archive a connected unproven CLI when there is no machineId', async () => {
        const { engine, rooms } = createEngine()
        try {
            const session = seedActiveSession(engine, 'no-machine')
            rooms.set(`session:${session.id}`, new Set(['sock-1']))
            gateway(engine).killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }

            await expect(engine.archiveSession(session.id)).rejects.toThrow(/not controllable/)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(true)
            expect(row?.metadata?.lifecycleState).not.toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('archives when KillSession and StopSession are both missing and no CLI socket remains', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'both-missing', { machineId: 'machine-1' })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async (machineId) => {
                throw missingStop(machineId)
            }

            await engine.archiveSession(session.id)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(false)
            expect(row?.metadata?.lifecycleState).toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('propagates non-missing KillSession errors', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'timeout')
            gateway(engine).killSession = async () => {
                throw new Error('RPC timeout')
            }

            await expect(engine.archiveSession(session.id)).rejects.toThrow(/RPC timeout/)
            expect(engine.getSessionByNamespace(session.id, 'default')?.active).toBe(true)
        } finally {
            engine.stop()
        }
    })
})
