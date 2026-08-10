import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
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
            value: 'win32',
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
