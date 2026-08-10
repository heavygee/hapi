import { afterEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'
import {
    startLocalResumeGrantServer,
    testLocalResumeSocketPath,
} from './localResumeGrant'

const sockets: string[] = []

afterEach(() => {
    for (const path of sockets.splice(0)) {
        try {
            if (existsSync(path)) unlinkSync(path)
        } catch {
            // ignore
        }
    }
})

async function requestCapability(socketPath: string, sessionId: string): Promise<{
    ok?: boolean
    code?: string
    sessionCapability?: string
}> {
    return await new Promise((resolve, reject) => {
        const socket = createConnection(socketPath)
        let buffered = ''
        const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error('timeout'))
        }, 5_000)
        socket.setEncoding('utf8')
        socket.on('connect', () => {
            socket.write(`${JSON.stringify({ sessionId })}\n`)
        })
        socket.on('data', (chunk) => {
            buffered += chunk
            const newline = buffered.indexOf('\n')
            if (newline < 0) return
            clearTimeout(timer)
            resolve(JSON.parse(buffered.slice(0, newline)))
            socket.end()
        })
        socket.on('error', reject)
    })
}

describe('localResumeGrant (#1473)', () => {
    it('refuses a tracked session minting another session capability', async () => {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            return
        }
        const socketPath = testLocalResumeSocketPath('hapi-local-resume-deny')
        sockets.push(socketPath)
        const server = await startLocalResumeGrantServer({
            socketPath,
            mintCapability: async () => 'cap-should-not-issue',
            resolveTrackedSessionId: () => 'session-a',
            readPeerCred: () => ({
                pid: process.pid,
                uid: process.getuid?.() ?? 0,
                gid: process.getgid?.() ?? 0,
            }),
        })
        expect(server).not.toBeNull()
        const response = await requestCapability(socketPath, 'session-b')
        expect(response.ok).toBe(false)
        expect(response.code).toBe('auth_failed')
        server!.close()
    })

    it('allows a tracked session to mint its own capability', async () => {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            return
        }
        const socketPath = testLocalResumeSocketPath('hapi-local-resume-self')
        sockets.push(socketPath)
        const server = await startLocalResumeGrantServer({
            socketPath,
            mintCapability: async (sessionId) => `cap-for-${sessionId}`,
            resolveTrackedSessionId: () => 'session-a',
            readPeerCred: () => ({
                pid: process.pid,
                uid: process.getuid?.() ?? 0,
                gid: process.getgid?.() ?? 0,
            }),
        })
        expect(server).not.toBeNull()
        const response = await requestCapability(socketPath, 'session-a')
        expect(response.ok).toBe(true)
        expect(response.sessionCapability).toBe('cap-for-session-a')
        server!.close()
    })

    it('refuses an untracked peer on the unix grant socket', async () => {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            return
        }
        const socketPath = testLocalResumeSocketPath('hapi-local-resume-untracked')
        sockets.push(socketPath)
        const server = await startLocalResumeGrantServer({
            socketPath,
            mintCapability: async () => 'cap-should-not-issue',
            resolveTrackedSessionId: () => null,
            readPeerCred: () => ({
                pid: process.pid,
                uid: process.getuid?.() ?? 0,
                gid: process.getgid?.() ?? 0,
            }),
        })
        expect(server).not.toBeNull()
        const response = await requestCapability(socketPath, 'session-b')
        expect(response.ok).toBe(false)
        expect(response.code).toBe('auth_failed')
        server!.close()
    })
})
