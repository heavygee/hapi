import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { PeerDeliverBroker } from './peerDeliverBroker'

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

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true })
        }
        pingPeerMock.mockReset()
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
        broker.start()

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
        broker.start()

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
})
