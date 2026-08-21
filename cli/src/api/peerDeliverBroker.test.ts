import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import {
    MAX_UNIX_SOCKET_PATH_BYTES,
    PeerDeliverBroker,
    authorizeBrokerListener,
    defaultBrokerSocketPath,
    requestParentPeerDeliver,
} from './peerDeliverBroker'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'

const pingPeerMock = vi.hoisted(() => vi.fn())

vi.mock('@/modules/pingPeer/pingPeer', () => ({
    PingPeerError: class PingPeerError extends Error {
        code: string
        constructor(code: string, message: string) {
            super(message)
            this.code = code
            this.name = 'PingPeerError'
        }
    },
    pingPeer: pingPeerMock,
}))

vi.mock('@/configuration', () => ({
    configuration: { happyHomeDir: '/tmp/.hapi-peer-broker-test' },
}))

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}))

describe('PeerDeliverBroker', () => {
    const dirs: string[] = []
    const previousXdg = process.env.XDG_RUNTIME_DIR
    const originalPlatform = process.platform

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true })
        }
        pingPeerMock.mockReset()
        if (previousXdg === undefined) {
            delete process.env.XDG_RUNTIME_DIR
        } else {
            process.env.XDG_RUNTIME_DIR = previousXdg
        }
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true,
        })
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('keeps the default socket path within the portable unix pathname budget', () => {
        delete process.env.XDG_RUNTIME_DIR
        const path = defaultBrokerSocketPath('11111111-1111-4111-8111-111111111111')
        expect(Buffer.byteLength(path, 'utf8')).toBeLessThanOrEqual(MAX_UNIX_SOCKET_PATH_BYTES)
    })

    it('uses a Windows named-pipe path on win32 (#1473)', () => {
        const original = process.platform
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        try {
            const path = defaultBrokerSocketPath('11111111-1111-4111-8111-111111111111')
            expect(path.startsWith('\\\\.\\pipe\\hapi-pd-')).toBe(true)
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true })
        }
    })

    it('rejects same-UID sibling callers that are not descendants of the owner', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-broker-'))
        dirs.push(dir)
        const socketPath = join(dir, 'b.sock')
        const broker = new PeerDeliverBroker({
            sessionId: 'session-b',
            sessionCapability: 'cap-b',
            ownerPid: process.pid,
            socketPath,
            // Simulate a non-descendant peer pid (sibling session A).
            readPeerCred: () => ({ pid: 1, uid: process.getuid?.() ?? 0, gid: 0 }),
        })
        await broker.start()

        const response = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            const socket = createConnection(socketPath)
            socket.on('data', (data) => {
                chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
                if (Buffer.concat(chunks).includes(0x0a)) {
                    socket.end()
                }
            })
            socket.on('error', reject)
            socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            socket.on('connect', () => {
                socket.write(`${JSON.stringify({
                    op: 'ping-peer',
                    sessionIdPrefix: '05d9f0f2',
                    message: 'steal',
                })}\n`)
            })
        })

        broker.stop()
        expect(JSON.parse(response.trim())).toMatchObject({
            ok: false,
            code: 'auth_failed',
        })
        expect(pingPeerMock).not.toHaveBeenCalled()
    })

    it('delivers via in-memory capability for descendant callers without returning the bearer', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-broker-'))
        dirs.push(dir)
        const socketPath = join(dir, 'a.sock')
        pingPeerMock.mockResolvedValue({
            sessionId: '05d9f0f2-9273-4137-933c-07459a1146a2',
            name: 'Target',
            resumed: false,
        })
        const broker = new PeerDeliverBroker({
            sessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            sessionCapability: 'cap-secret',
            ownerPid: process.pid,
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
        })
        await broker.start()

        const response = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            const socket = createConnection(socketPath)
            socket.on('data', (data) => {
                chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
                if (Buffer.concat(chunks).includes(0x0a)) {
                    socket.end()
                }
            })
            socket.on('error', reject)
            socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            socket.on('connect', () => {
                socket.write(`${JSON.stringify({
                    op: 'ping-peer',
                    sessionIdPrefix: '05d9f0f2',
                    message: 'handoff',
                })}\n`)
            })
        })

        broker.stop()
        const parsed = JSON.parse(response.trim())
        expect(parsed.ok).toBe(true)
        expect(parsed).not.toHaveProperty('sessionCapability')
        expect(JSON.stringify(parsed)).not.toContain('cap-secret')
        expect(pingPeerMock).toHaveBeenCalledWith(expect.objectContaining({
            authenticatedSourceSessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            sessionCapability: 'cap-secret',
            message: 'handoff',
        }))
    })

    it('does not reject the connection handler when a client disconnects mid-request', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-broker-'))
        dirs.push(dir)
        const socketPath = join(dir, 'drop.sock')
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => {
            unhandled.push(reason)
        }
        process.on('unhandledRejection', onUnhandled)
        const broker = new PeerDeliverBroker({
            sessionId: 'session-drop',
            sessionCapability: 'cap',
            ownerPid: process.pid,
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: 0 }),
        })
        await broker.start()
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = createConnection(socketPath)
                socket.on('connect', () => {
                    socket.write('{"op":"ping-peer"')
                    socket.destroy()
                })
                socket.on('close', () => resolve())
                socket.on('error', () => resolve())
                setTimeout(() => reject(new Error('timed out waiting for disconnect')), 2_000)
            })
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', onUnhandled)
            broker.stop()
        }
    })

    it('authorizeBrokerListener: fails closed when peercred is null (incl. win32)', () => {
        expect(authorizeBrokerListener(null, process.pid, process.pid, 'win32')).toBe(false)
        expect(authorizeBrokerListener(null, undefined, process.pid, 'linux')).toBe(false)
        expect(authorizeBrokerListener(
            { pid: process.pid, uid: 0, gid: 0 },
            process.pid,
            process.pid,
            'win32',
        )).toBe(true)
        expect(authorizeBrokerListener(
            { pid: process.pid + 99_999, uid: 0, gid: 0 },
            process.pid,
            process.pid,
            'win32',
        )).toBe(false)
    })

    it('rejects win32 broker deliver when named-pipe peer pid is unavailable', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        process.env[HAPI_SESSION_ID_ENV] = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-broker-'))
        dirs.push(dir)
        const socketPath = join(dir, 'win32.sock')
        pingPeerMock.mockResolvedValue({
            sessionId: '05d9f0f2-9273-4137-933c-07459a1146a2',
            name: 'Target',
            resumed: false,
        })
        const broker = new PeerDeliverBroker({
            sessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            sessionCapability: 'cap-win32',
            ownerPid: process.pid,
            socketPath,
            readPeerCred: () => null,
        })
        await broker.start()
        try {
            await expect(requestParentPeerDeliver({
                sessionIdPrefix: '05d9f0f2',
                message: 'teemo ping',
                socketPath,
                readPeerCred: () => null,
            })).rejects.toMatchObject({ code: 'auth_failed' })
            expect(pingPeerMock).not.toHaveBeenCalled()
        } finally {
            broker.stop()
        }
    })

    it('client rejects a listener that is not an ancestor (M3)', async () => {
        process.env[HAPI_SESSION_ID_ENV] = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-broker-'))
        dirs.push(dir)
        const socketPath = join(dir, 'hijack.sock')
        // Minimal listener that accepts connections (simulates sibling rebind).
        const { createServer } = await import('node:net')
        const server = createServer((socket) => {
            socket.on('error', () => {
                // client may hang up after ancestor check fails
            })
            socket.end(`${JSON.stringify({ ok: true, result: { sessionId: 'x', name: 'x', resumed: false } })}\n`)
        })
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(socketPath, resolve)
        })
        try {
            await expect(requestParentPeerDeliver({
                sessionIdPrefix: '05d9f0f2',
                message: 'intercept-me',
                socketPath,
                // Unrelated pid (not init/1 — every process descends from 1).
                readPeerCred: () => ({ pid: process.pid + 99999, uid: 0, gid: 0 }),
            })).rejects.toMatchObject({ code: 'auth_failed' })
        } finally {
            await new Promise<void>((resolve) => {
                server.close(() => resolve())
            })
            delete process.env[HAPI_SESSION_ID_ENV]
        }
    })
})
