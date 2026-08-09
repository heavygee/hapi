import { describe, expect, it, mock } from 'bun:test'
import { mintPeerSessionCapability } from '../../../web/peerCapability'
import { registerCliHandlers } from './index'

const JWT_SECRET = new TextEncoder().encode('peer-cap-socket-test-secret')
const SESSION_ID = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
const OTHER_SESSION_ID = '05d9f0f2-9273-4137-933c-07459a1146a2'

function createSocketHarness(auth: Record<string, unknown>) {
    const emitted: Array<{ event: string; data: unknown }> = []
    const joined: string[] = []
    const socket = {
        data: { namespace: 'test-ns' },
        handshake: { auth },
        join: (room: string) => {
            joined.push(room)
        },
        emit: (event: string, data: unknown) => {
            emitted.push({ event, data })
        },
        on: mock(() => socket),
    }
    return { socket, emitted, joined }
}

function createDeps(sessionIds: string[]) {
    const sessions = new Set(sessionIds)
    return {
        io: { of: () => ({}) },
        store: {
            sessions: {
                getSessionByNamespace: (id: string, namespace: string) => (
                    namespace === 'test-ns' && sessions.has(id) ? { id } : null
                ),
                getSession: (id: string) => (sessions.has(id) ? { id } : null),
            },
            machines: {
                getMachineByNamespace: () => null,
                getMachine: () => null,
            },
        },
        rpcRegistry: { unregisterAll: mock(() => {}) },
        terminalRegistry: {},
        jwtSecret: JWT_SECRET,
    } as never
}

describe('registerCliHandlers peer-capability (#1203 resume)', () => {
    it('emits a capability for the handshake session when access resolves', () => {
        const { socket, emitted, joined } = createSocketHarness({
            sessionId: SESSION_ID,
            clientType: 'session-scoped',
        })

        registerCliHandlers(socket as never, createDeps([SESSION_ID]))

        expect(joined).toContain(`session:${SESSION_ID}`)
        expect(emitted).toContainEqual({
            event: 'peer-capability',
            data: {
                sessionId: SESSION_ID,
                sessionCapability: mintPeerSessionCapability(SESSION_ID, JWT_SECRET),
            },
        })
    })

    it('does not emit a capability for a foreign session id', () => {
        const { socket, emitted, joined } = createSocketHarness({
            sessionId: OTHER_SESSION_ID,
            clientType: 'session-scoped',
        })

        // Only SESSION_ID exists in this namespace — OTHER is missing.
        registerCliHandlers(socket as never, createDeps([SESSION_ID]))

        expect(joined).not.toContain(`session:${OTHER_SESSION_ID}`)
        expect(emitted.filter((entry) => entry.event === 'peer-capability')).toEqual([])
    })
})
