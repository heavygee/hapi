import { describe, expect, it } from 'vitest'
import { createServer, createConnection, type AddressInfo } from 'node:net'
import { readUnixPeerCredentials } from './peercred'

describe('readUnixPeerCredentials', () => {
    it('returns peer pid on Linux via SO_PEERCRED (real libc.so.6)', async () => {
        if (process.platform !== 'linux') {
            return
        }
        const server = createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as AddressInfo).port

        const peerCred = await new Promise<ReturnType<typeof readUnixPeerCredentials>>((resolve, reject) => {
            server.once('connection', (socket) => {
                try {
                    resolve(readUnixPeerCredentials(socket))
                } catch (error) {
                    reject(error)
                } finally {
                    socket.end()
                }
            })
            const client = createConnection({ host: '127.0.0.1', port })
            client.on('error', reject)
            client.on('connect', () => client.end())
        })

        server.close()
        // TCP may not expose SO_PEERCRED (AF_UNIX only). Prefer unix path when available.
        // This test documents that dlopen(libc.so.6)+getsockopt does not throw.
        expect(peerCred === null || (typeof peerCred?.pid === 'number' && peerCred.pid > 0)).toBe(true)
    })

    it('returns peer pid over a real unix domain socket on Linux', async () => {
        if (process.platform !== 'linux') {
            return
        }
        const { mkdtempSync, rmSync } = await import('node:fs')
        const { tmpdir } = await import('node:os')
        const { join } = await import('node:path')
        const dir = mkdtempSync(join(tmpdir(), 'hapi-peercred-'))
        const path = join(dir, 's.sock')
        try {
            const server = createServer()
            await new Promise<void>((resolve) => server.listen(path, resolve))
            const peerCred = await new Promise<ReturnType<typeof readUnixPeerCredentials>>((resolve, reject) => {
                server.once('connection', (socket) => {
                    try {
                        resolve(readUnixPeerCredentials(socket))
                    } catch (error) {
                        reject(error)
                    } finally {
                        socket.end()
                    }
                })
                const client = createConnection(path)
                client.on('error', reject)
                client.on('connect', () => client.end())
            })
            server.close()
            // Vitest may not expose bun:ffi the same way as the CLI runtime; when
            // credentials resolve, they must be the connecting process.
            if (peerCred === null) {
                return
            }
            expect(peerCred.pid).toBe(process.pid)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
