import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    authorizePeerCapInjectClient,
    receivePeerCapabilityFromRunner,
    receiveRunnerProofFromHandoff,
    startPeerCapabilityInjectServer,
} from './peerCapabilityInject'

describe('peerCapabilityInject (#1203 pass 2h)', () => {
    const temps: string[] = []
    const originalPlatform = process.platform

    afterEach(() => {
        for (const dir of temps.splice(0)) {
            try {
                rmSync(dir, { recursive: true, force: true })
            } catch {
                // ignore
            }
        }
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true,
        })
    })

    function tempSock(): string {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peer-cap-'))
        temps.push(dir)
        return join(dir, 'inject.sock')
    }

    it('delivers capability only to the expected child pid', async () => {
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }),
        })
        expect(server).not.toBeNull()
        try {
            const deliver = server!.deliverTo(process.pid, { sessionCapability: 'cap-for-child' })
            const capability = await receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 20,
                readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
            })
            await deliver
            expect(capability).toBe('cap-for-child')
        } finally {
            server!.close()
        }
    })

    it('delivers runnerProof without putting the secret in env', async () => {
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }),
        })
        expect(server).not.toBeNull()
        try {
            const deliver = server!.deliverTo(process.pid, { runnerProof: 'proof-handoff' })
            const proof = await receiveRunnerProofFromHandoff({
                socketPath,
                ownerPid: process.pid,
                attempts: 20,
                readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
            })
            await deliver
            expect(proof).toBe('proof-handoff')
        } finally {
            server!.close()
        }
    })

    it('does not hang when a listener accepts then ends without a newline', async () => {
        const socketPath = tempSock()
        const server = createServer((socket) => {
            socket.end()
        })
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(socketPath, () => resolve())
        })
        try {
            const started = Date.now()
            const proof = await receiveRunnerProofFromHandoff({
                socketPath,
                ownerPid: process.pid,
                attempts: 2,
                readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
            })
            expect(proof).toBeUndefined()
            // Without end/close/timeout settling, the first tryReceiveOnce hangs forever.
            expect(Date.now() - started).toBeLessThan(8_000)
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()))
        }
    })

    it('delivers capability when child connects before deliverTo arms payload', async () => {
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }),
        })
        expect(server).not.toBeNull()
        try {
            // Child connects first (resume race).
            const capabilityPromise = receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 100,
                readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
            })
            await new Promise((r) => setTimeout(r, 50))
            const deliver = server!.deliverTo(process.pid, { sessionCapability: 'cap-after-connect' })
            const capability = await capabilityPromise
            await deliver
            expect(capability).toBe('cap-after-connect')
        } finally {
            server!.close()
        }
    })

    it('still receives when client peercred is null only on connect (Bun race)', async () => {
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }),
        })
        expect(server).not.toBeNull()
        try {
            const deliver = server!.deliverTo(process.pid, { sessionCapability: 'cap-null-cred' })
            let credReads = 0
            const capability = await receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 20,
                // Connect-time null, then peercred available before accepting payload.
                readPeerCred: () => {
                    credReads += 1
                    if (credReads === 1) {
                        return null
                    }
                    return { pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }
                },
            })
            await deliver
            expect(capability).toBe('cap-null-cred')
        } finally {
            server!.close()
        }
    })

    it('rejects inject when client peercred stays null through payload', async () => {
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }),
        })
        expect(server).not.toBeNull()
        try {
            void server!.deliverTo(process.pid, { sessionCapability: 'cap-never-cred' })
            const capability = await receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 5,
                readPeerCred: () => null,
            })
            expect(capability).toBeUndefined()
        } finally {
            server!.close()
        }
    })

    it('authorizePeerCapInjectClient: fails closed when peercred is null (incl. win32)', () => {
        expect(authorizePeerCapInjectClient(null, process.pid, 'win32')).toBe(false)
        expect(authorizePeerCapInjectClient(null, process.pid, 'linux')).toBe(false)
        expect(authorizePeerCapInjectClient(
            { pid: process.pid, uid: 0, gid: 0 },
            process.pid,
            'win32',
        )).toBe(true)
    })

    it('rejects win32 inject when server cannot read named-pipe client pid', async () => {
        Object.defineProperty(process, 'platform', {
            value: 'win32',
            configurable: true,
        })
        const socketPath = tempSock()
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            // Bun Windows: GetNamedPipeClientProcessId never works (fd=-1).
            readPeerCred: () => null,
        })
        expect(server).not.toBeNull()
        try {
            const deliver = server!.deliverTo(process.pid, { sessionCapability: 'cap-win32-null-cred' })
            const capability = await receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 5,
                readPeerCred: () => null,
            })
            expect(capability).toBeUndefined()
            server!.close()
            await expect(deliver).rejects.toThrow(/closed|timed out/)
        } finally {
            server!.close()
        }
    })

    it('rejects a sibling pid that is not the expected child', async () => {
        const socketPath = tempSock()
        const siblingPid = process.pid + 10_000_000
        const server = await startPeerCapabilityInjectServer({
            socketPath,
            readPeerCred: () => ({ pid: siblingPid, uid: 0, gid: 0 }),
        })
        expect(server).not.toBeNull()
        try {
            let delivered = false
            const deliver = server!.deliverTo(process.pid, { sessionCapability: 'cap-secret' }).then(() => {
                delivered = true
            }).catch(() => {
                // timeout / close expected when no authorized child connects
            })
            const capability = await receivePeerCapabilityFromRunner({
                socketPath,
                ownerPid: process.pid,
                attempts: 5,
                readPeerCred: () => ({ pid: process.pid, uid: 0, gid: 0 }),
            })
            expect(capability).toBeUndefined()
            expect(delivered).toBe(false)
            server!.close()
            await deliver
        } finally {
            try {
                server!.close()
            } catch {
                // ignore
            }
        }
    })

    it('returns null on unsupported platforms without throwing', async () => {
        Object.defineProperty(process, 'platform', {
            value: 'aix',
            configurable: true,
        })
        const server = await startPeerCapabilityInjectServer({ socketPath: tempSock() })
        expect(server).toBeNull()
    })

    it('returns null when listen fails without taking down the process', async () => {
        const blocker = tempSock()
        writeFileSync(blocker, 'not-a-directory')
        const server = await startPeerCapabilityInjectServer({
            // Parent path is a file, so mkdir/bind cannot create the socket.
            socketPath: join(blocker, 'nested.sock'),
        })
        expect(server).toBeNull()
    })
})
