import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { RpcTargetMissingError } from './rpcGateway'
import { SessionArchiveUncontrollableError, SyncEngine } from './syncEngine'

type StopStatus = 'stopped' | 'already_gone' | 'still_alive' | 'unknown'

type RpcGatewayStub = {
    killSession: (sessionId: string) => Promise<void>
    stopRunnerSession: (machineId: string, sessionId: string) => Promise<StopStatus>
}

function gateway(engine: SyncEngine): RpcGatewayStub {
    return (engine as unknown as { rpcGateway: RpcGatewayStub }).rpcGateway
}

function createIo() {
    return {
        of() {
            return {
                to() {
                    return { emit() {} }
                }
            }
        }
    } as never
}

function createEngine() {
    const store = new Store(':memory:')
    const engine = new SyncEngine(store, createIo(), new RpcRegistry(), { broadcast() {} } as never)
    return { store, engine }
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

/**
 * #1911 supersedes the incomplete #1706 / #1203 heartbeat-gated archive path.
 * Archive always asks StopSession when a machineId is known; KillSession miss
 * alone never proves the process gone.
 */
describe('archiveSession (#1911 runner reaping / #1203 successor)', () => {
    it('always calls StopSession after KillSession succeeds', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'kill-ok', { machineId: 'machine-1' })
            const stops: string[] = []
            const rpc = gateway(engine)
            rpc.killSession = async () => {}
            rpc.stopRunnerSession = async (_machineId, sessionId) => {
                stops.push(sessionId)
                return 'already_gone'
            }

            await engine.archiveSession(session.id)

            expect(engine.getSessionByNamespace(session.id, 'default')?.active).toBe(false)
            expect(stops).toEqual([session.id])
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

            await expect(engine.archiveSession(session.id)).rejects.toBeInstanceOf(
                SessionArchiveUncontrollableError
            )

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(true)
            expect(row?.metadata?.lifecycleState).not.toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('archives when StopSession is already_gone after KillSession miss (no heartbeat gate)', async () => {
        // #1911: runner confirmation is authoritative — do not second-guess with
        // heartbeat after already_gone (that was the incomplete #1706 path).
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'zombie-active', { machineId: 'machine-1' })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async () => 'already_gone'

            await engine.archiveSession(session.id)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(false)
            expect(row?.metadata?.lifecycleState).toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('archives the classic #916 case: no kill handler, runner already_gone', async () => {
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'truly-gone', { machineId: 'machine-1' })
            engine.handleSessionEnd({ sid: session.id, time: Date.now() })
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

    it('archives when KillSession misses and there is no machineId to verify against', async () => {
        // No machine → cannot StopSession; #1911 still allows hub archive +
        // Socket.IO metadata push so a reconnecting CLI can exit.
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'no-machine')
            gateway(engine).killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }

            await engine.archiveSession(session.id)

            const row = engine.getSessionByNamespace(session.id, 'default')
            expect(row?.active).toBe(false)
            expect(row?.metadata?.lifecycleState).toBe('archived')
        } finally {
            engine.stop()
        }
    })

    it('refuses when KillSession and StopSession are both missing (unconfirmed)', async () => {
        // Detached children can outlive both RPCs — refuse without confirmation.
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'both-missing-live', { machineId: 'machine-1' })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async (machineId) => {
                throw missingStop(machineId)
            }

            await expect(engine.archiveSession(session.id)).rejects.toBeInstanceOf(
                SessionArchiveUncontrollableError
            )
            expect(engine.getSessionByNamespace(session.id, 'default')?.active).toBe(true)
        } finally {
            engine.stop()
        }
    })

    it('refuses when StopSession RPC is missing even if heartbeat already expired', async () => {
        // Same unconfirmed machine RPC — heartbeat expiry alone is not enough (#1910).
        const { engine } = createEngine()
        try {
            const session = seedActiveSession(engine, 'both-missing-dead', { machineId: 'machine-1' })
            engine.handleSessionEnd({ sid: session.id, time: Date.now() })
            const rpc = gateway(engine)
            rpc.killSession = async (sessionId) => {
                throw missingKill(sessionId)
            }
            rpc.stopRunnerSession = async (machineId) => {
                throw missingStop(machineId)
            }

            await expect(engine.archiveSession(session.id)).rejects.toBeInstanceOf(
                SessionArchiveUncontrollableError
            )
            expect(engine.getSessionByNamespace(session.id, 'default')?.active).toBe(false)
            expect(engine.getSessionByNamespace(session.id, 'default')?.metadata?.lifecycleState)
                .not.toBe('archived')
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
