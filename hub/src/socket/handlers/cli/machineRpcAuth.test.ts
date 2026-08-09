import { describe, expect, it, mock } from 'bun:test'
import { registerCliHandlers } from './index'

const JWT_SECRET = new TextEncoder().encode('machine-rpc-auth-test')

function createSocketHarness(auth: Record<string, unknown>) {
    const registered: Array<{ method: string; ack?: { registered: boolean } }> = []
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const socket = {
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
    return { socket, handlers, registered }
}

describe('machine RPC auth (#1473 B1)', () => {
    it('does not authorize machine RPC when machineId is presented without tag', () => {
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: {
                    getMachineByNamespace: () => ({
                        id: 'machine-1',
                        namespace: 'test-ns',
                        tag: 'secret-tag',
                    }),
                    getMachine: () => null,
                },
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

    it('authorizes machine RPC when handshake machineTag matches stored tag', () => {
        const register = mock(() => true)
        const { socket, handlers } = createSocketHarness({
            machineId: 'machine-1',
            machineTag: 'secret-tag',
            clientType: 'machine-scoped',
        })
        registerCliHandlers(socket as never, {
            io: { of: () => ({}) },
            store: {
                sessions: { getSessionByNamespace: () => null, getSession: () => null },
                machines: {
                    getMachineByNamespace: () => ({
                        id: 'machine-1',
                        namespace: 'test-ns',
                        tag: 'secret-tag',
                    }),
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

        expect(socket.data.machineRpcAuthorizedId).toBe('machine-1')
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'machine-1:spawn-happy-session' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: true })
        expect(register).toHaveBeenCalled()
    })

    it('authorizes session-scoped RPC when session access resolves', () => {
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

        expect(socket.data.sessionRpcAuthorizedId).toBe('session-1')
        let ackResult: { registered?: boolean } | undefined
        handlers.get('rpc-register')?.({ method: 'session-1:permission' }, (response: { registered: boolean }) => {
            ackResult = response
        })
        expect(ackResult).toEqual({ registered: true })
        expect(register).toHaveBeenCalled()
    })
})
