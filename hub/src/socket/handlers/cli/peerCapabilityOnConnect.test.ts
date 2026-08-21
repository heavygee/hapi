import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mintPeerSessionCapability } from '../../../web/peerCapability'
import {
    armResumePeerMint,
    clearResumePeerMintsForTests,
} from '../../../web/pendingResumePeerMint'
import { registerCliHandlers } from './index'

const JWT_SECRET = new TextEncoder().encode('peer-cap-socket-test-secret')
const SESSION_A = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
const SESSION_B = '05d9f0f2-9273-4137-933c-07459a1146a2'
const TAG_A = 'tag-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TAG_B = 'tag-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

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

function createDeps(sessions: Array<{ id: string; tag: string }>) {
    const byId = new Map(sessions.map((session) => [session.id, session]))
    return {
        io: { of: () => ({}) },
        store: {
            sessions: {
                getSessionByNamespace: (id: string, namespace: string) => (
                    namespace === 'test-ns' && byId.has(id) ? byId.get(id) : null
                ),
                getSession: (id: string) => byId.get(id) ?? null,
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

describe('registerCliHandlers peer-capability (#1203 resume / B3)', () => {
    beforeEach(() => {
        clearResumePeerMintsForTests()
    })

    it('emits a capability only when handshake sessionTag matches the stored tag', () => {
        const { socket, emitted, joined } = createSocketHarness({
            sessionId: SESSION_A,
            sessionTag: TAG_A,
            clientType: 'session-scoped',
        })

        registerCliHandlers(socket as never, createDeps([
            { id: SESSION_A, tag: TAG_A },
            { id: SESSION_B, tag: TAG_B },
        ]))

        expect(joined).toContain(`session:${SESSION_A}`)
        expect(emitted).toContainEqual({
            event: 'peer-capability',
            data: {
                sessionId: SESSION_A,
                sessionCapability: mintPeerSessionCapability(SESSION_A, JWT_SECRET),
            },
        })
    })

    it('does not mint when a sibling presents another existing sessionId without its tag', () => {
        const { socket, emitted, joined } = createSocketHarness({
            sessionId: SESSION_B,
            clientType: 'session-scoped',
        })

        registerCliHandlers(socket as never, createDeps([
            { id: SESSION_A, tag: TAG_A },
            { id: SESSION_B, tag: TAG_B },
        ]))

        expect(joined).toContain(`session:${SESSION_B}`)
        expect(emitted.filter((entry) => entry.event === 'peer-capability')).toEqual([])
    })

    it('does not mint when session A presents session B id with A\'s tag', () => {
        const { socket, emitted } = createSocketHarness({
            sessionId: SESSION_B,
            sessionTag: TAG_A,
            clientType: 'session-scoped',
        })

        registerCliHandlers(socket as never, createDeps([
            { id: SESSION_A, tag: TAG_A },
            { id: SESSION_B, tag: TAG_B },
        ]))

        expect(emitted.filter((entry) => entry.event === 'peer-capability')).toEqual([])
    })

    it('does not emit a capability for a foreign session id outside the namespace', () => {
        const { socket, emitted, joined } = createSocketHarness({
            sessionId: SESSION_B,
            sessionTag: TAG_B,
            clientType: 'session-scoped',
        })

        registerCliHandlers(socket as never, createDeps([{ id: SESSION_A, tag: TAG_A }]))

        expect(joined).not.toContain(`session:${SESSION_B}`)
        expect(emitted.filter((entry) => entry.event === 'peer-capability')).toEqual([])
    })

    it('does not mint on /cli connect even when a resume mint is armed (pass 2h B1)', () => {
        armResumePeerMint(SESSION_B)
        const { socket, emitted } = createSocketHarness({
            sessionId: SESSION_B,
            clientType: 'session-scoped',
        })
        registerCliHandlers(socket as never, createDeps([
            { id: SESSION_A, tag: TAG_A },
            { id: SESSION_B, tag: TAG_B },
        ]))
        expect(emitted.filter((entry) => entry.event === 'peer-capability')).toEqual([])
    })
})
