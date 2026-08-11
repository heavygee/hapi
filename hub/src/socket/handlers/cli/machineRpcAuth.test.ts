import { describe, expect, it, mock } from 'bun:test'
import { hashRunnerProof } from '../../runnerLease'
import { registerCliHandlers } from './index'

const JWT_SECRET = new TextEncoder().encode('machine-rpc-auth-test')
const PROOF = 'proof-1'
const PROOF_HASH = hashRunnerProof(PROOF)

function createSocketHarness(auth: Record<string, unknown>, socketId = 'sock-1') {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const socket = {
        id: socketId,
        data: { namespace: 'test-ns' } as {
            namespace: string
            machineRpcAuthorizedId?: string
            sessionRpcAuthorizedId?: string
        },
        handshake: { auth },
        join: mock(() => {}),
        emit: mock(() => {}),
        on: (event: string, handler: (...args: unknown[]) => void) => {
            handlers.set(event, handler)
            return socket
        },
    }
    return { socket, handlers }
}

function machineStore(overrides?: { runnerProofHash?: string | null }) {
    return {
        getMachineByNamespace: () => ({
            id: 'machine-1',
            namespace: 'test-ns',
            tag: 'secret-tag',
            runnerProofHash: overrides?.runnerProofHash === undefined
                ? PROOF_HASH
                : overrides.runnerProofHash,
        }),
        getMachine: () => null,
    }
}

describe('machine RPC auth (#1473 B1)', () => {
    it('does not authorize machine RPC when machineId is presented without tag', () => {
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            runnerProof: PROOF,
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: machineStore(),
            },
            rpcRegistry: {
                register: mock(() => true),
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)

        expect(socket.data.machineRpcAuthorizedId).toBeUndefined()
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'machine-1:spawn-happy-session' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: false })
    })

    it('does not authorize machine RPC with machineTag but no hub-bound proof hash', () => {
        const { socket } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            runnerProof: PROOF,
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: machineStore({ runnerProofHash: null }),
            },
            rpcRegistry: {
                register: mock(() => true),
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)

        expect(socket.data.machineRpcAuthorizedId).toBeUndefined()
    })

    it('authorizes machine RPC when tag matches and proof verifies the stored hash', () => {
        const register = mock(() => true)
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            runnerProof: PROOF,
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: machineStore(),
            },
            rpcRegistry: {
                register,
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)

        expect(socket.data.machineRpcAuthorizedId).toBe('machine-1')
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'machine-1:spawn-happy-session' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: true })
        expect(register).toHaveBeenCalled()
    })

    it('rejects a sibling inventing a different runnerProof against the bound hash', () => {
        const { socket } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            runnerProof: 'proof-sibling',
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: machineStore(),
            },
            rpcRegistry: {
                register: mock(() => true),
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)
        expect(socket.data.machineRpcAuthorizedId).toBeUndefined()
    })

    it('authorizes session-scoped RPC when create-time session tag matches', () => {
        const register = mock(() => true)
        const { socket, handlers } = createSocketHarness({
            sessionId: 'session-1',
            sessionTag: 'session-tag',
            clientType: 'session-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: {
                    getSessionByNamespace: () => ({
                        id: 'session-1',
                        namespace: 'test-ns',
                        tag: 'session-tag',
                    }),
                    getSession: () => null,
                },
                machines: {
                    getMachineByNamespace: () => null,
                    getMachine: () => null,
                },
            },
            rpcRegistry: {
                register,
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)

        expect(socket.data.sessionRpcAuthorizedId).toBe('session-1')
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'session-1:permission' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: true })
        expect(register).toHaveBeenCalled()
    })

    it('rejects session-scoped RPC when only sessionId is presented (namespace squat)', () => {
        const register = mock(() => true)
        const { socket, handlers } = createSocketHarness({
            sessionId: 'session-1',
            clientType: 'session-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: {
                    getSessionByNamespace: () => ({
                        id: 'session-1',
                        namespace: 'test-ns',
                        tag: 'session-tag',
                    }),
                    getSession: () => null,
                },
                machines: {
                    getMachineByNamespace: () => null,
                    getMachine: () => null,
                },
            },
            rpcRegistry: {
                register,
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
        } as never)

        expect(socket.data.sessionRpcAuthorizedId).toBeUndefined()
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'session-1:permission' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: false })
        expect(register).not.toHaveBeenCalled()
    })

    it('rejects machine-alive and state mutations without runner-proof bind', () => {
        const onMachineAlive = mock(() => {})
        const updateMetadata = mock(() => ({ result: 'success', version: 2, value: {} }))
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            runnerProof: 'proof-sibling',
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: {
                    ...machineStore(),
                    updateMachineMetadata: updateMetadata,
                    updateMachineRunnerState: mock(() => ({ result: 'success', version: 2, value: {} })),
                },
            },
            rpcRegistry: {
                register: mock(() => true),
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
            onMachineAlive,
        } as never)

        expect(socket.data.machineRpcAuthorizedId).toBeUndefined()
        handlers.get('machine-alive')?.({ machineId: 'machine-1', time: Date.now() })
        expect(onMachineAlive).not.toHaveBeenCalled()

        let metaAck: { result?: string; reason?: string } | undefined
        handlers.get('machine-update-metadata')?.(
            { machineId: 'machine-1', expectedVersion: 1, metadata: { host: 'hijack' } },
            (response: { result: string; reason?: string }) => {
                metaAck = response
            }
        )
        expect(metaAck).toEqual({ result: 'error', reason: 'access-denied' })
        expect(updateMetadata).not.toHaveBeenCalled()
    })

    it('accepts machine-alive when the socket is runner-proof bound', () => {
        const onMachineAlive = mock(() => {})
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            runnerProof: PROOF,
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: machineStore(),
            },
            rpcRegistry: {
                register: mock(() => true),
                unregister: mock(() => {}),
                unregisterAll: mock(() => {}),
            },
            terminalRegistry: {},
            jwtSecret: JWT_SECRET,
            onMachineAlive,
        } as never)

        expect(socket.data.machineRpcAuthorizedId).toBe('machine-1')
        handlers.get('machine-alive')?.({ machineId: 'machine-1', time: 42 })
        expect(onMachineAlive).toHaveBeenCalled()
    })
})
