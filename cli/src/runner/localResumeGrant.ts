import { randomBytes } from 'node:crypto'
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@/ui/logger'
import { readUnixPeerCredentials, type PeerCredentials } from '@/api/peercred'
import {
    readWindowsNamedPipeClientCredentials,
    readWindowsNamedPipeServerCredentials,
} from '@/api/peerCapabilityInject'

export type LocalResumeGrantHandler = (opts: {
    sessionId: string
    clientPid: number
}) => Promise<{ sessionCapability?: string; error?: string }>

export type LocalResumeGrantServer = {
    path: string
    close: () => void
}

/**
 * Peercred-authenticated local resume grant (#1473 Blocker).
 *
 * Resume CLI connects over AF_UNIX / Windows named pipe. Client PID is taken
 * from kernel peer credentials — never from the JSON body. Capability is
 * returned on the same connection (no second hop / inject race).
 */
export async function startLocalResumeGrantServer(
    handle: LocalResumeGrantHandler
): Promise<LocalResumeGrantServer | null> {
    if (
        process.platform !== 'linux'
        && process.platform !== 'darwin'
        && process.platform !== 'win32'
    ) {
        return null
    }

    const socketPath = defaultGrantSocketPath()
    let server: Server | null = null

    try {
        if (process.platform !== 'win32') {
            mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
            if (existsSync(socketPath)) {
                try {
                    unlinkSync(socketPath)
                } catch {
                    // replace
                }
            }
        }

        server = createServer((socket) => {
            void serveGrantConnection(socket, handle)
        })

        await new Promise<void>((resolve, reject) => {
            server!.once('error', reject)
            server!.listen(socketPath, resolve)
        })
    } catch (error) {
        logger.debug('[local-resume-grant] listen failed', error)
        server?.close()
        return null
    }

    if (process.platform !== 'win32') {
        try {
            chmodSync(socketPath, 0o600)
        } catch {
            // best-effort
        }
    }

    const listening = server
    return {
        path: socketPath,
        close: () => {
            listening.close()
            if (process.platform !== 'win32') {
                try {
                    unlinkSync(socketPath)
                } catch {
                    // ignore
                }
            }
        },
    }
}

async function serveGrantConnection(
    socket: Socket,
    handle: LocalResumeGrantHandler
): Promise<void> {
    const finish = (payload: Record<string, unknown>) => {
        try {
            socket.end(`${JSON.stringify(payload)}\n`)
        } catch {
            // ignore
        }
    }
    try {
        const cred = readGrantClientCredentials(socket)
        if (!cred || cred.pid <= 0) {
            finish({ ok: false, error: 'Authenticated local peer required' })
            return
        }
        const chunks: Buffer[] = []
        const body = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('grant request timeout')), 5_000)
            socket.on('data', (data) => {
                chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
                if (Buffer.concat(chunks).includes(0x0a)) {
                    clearTimeout(timer)
                    resolve(Buffer.concat(chunks).toString('utf8'))
                }
            })
            socket.on('error', reject)
            socket.on('end', () => {
                clearTimeout(timer)
                resolve(Buffer.concat(chunks).toString('utf8'))
            })
        })
        let sessionId = ''
        try {
            const parsed = JSON.parse(body.trim()) as { sessionId?: unknown }
            sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : ''
        } catch {
            finish({ ok: false, error: 'Invalid grant request' })
            return
        }
        if (!sessionId) {
            finish({ ok: false, error: 'sessionId required' })
            return
        }
        const result = await handle({ sessionId, clientPid: cred.pid })
        if (!result.sessionCapability) {
            finish({ ok: false, error: result.error ?? 'Grant failed' })
            return
        }
        finish({ ok: true, sessionCapability: result.sessionCapability })
    } catch (error) {
        logger.debug('[local-resume-grant] connection failed', error)
        finish({ ok: false, error: 'Grant failed' })
    }
}

function readGrantClientCredentials(socket: Socket): PeerCredentials | null {
    if (process.platform === 'win32') {
        return readWindowsNamedPipeClientCredentials(socket)
    }
    return readUnixPeerCredentials(socket)
}

export async function requestLocalResumeGrant(options: {
    socketPath: string
    sessionId: string
    expectedServerPid: number
    timeoutMs?: number
}): Promise<{ sessionCapability?: string; error?: string }> {
    const timeoutMs = options.timeoutMs ?? 10_000
    return await new Promise((resolve) => {
        const chunks: Buffer[] = []
        const socket = createConnection(options.socketPath)
        const timer = setTimeout(() => {
            socket.destroy()
            resolve({ error: 'Local resume grant timed out' })
        }, timeoutMs)
        const done = (result: { sessionCapability?: string; error?: string }) => {
            clearTimeout(timer)
            socket.removeAllListeners()
            socket.on('error', () => {})
            try {
                socket.end()
            } catch {
                // ignore
            }
            resolve(result)
        }
        socket.on('error', (error) => {
            done({ error: error instanceof Error ? error.message : 'Grant connect failed' })
        })
        socket.on('connect', () => {
            const serverCred = readGrantServerCredentials(socket)
            if (!serverCred || serverCred.pid !== options.expectedServerPid) {
                done({ error: 'Local resume grant server identity mismatch' })
                return
            }
            socket.write(`${JSON.stringify({ sessionId: options.sessionId })}\n`)
        })
        socket.on('data', (data) => {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
            if (!Buffer.concat(chunks).includes(0x0a)) {
                return
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as {
                    ok?: boolean
                    sessionCapability?: string
                    error?: string
                }
                if (parsed.ok && typeof parsed.sessionCapability === 'string' && parsed.sessionCapability.trim()) {
                    done({ sessionCapability: parsed.sessionCapability.trim() })
                    return
                }
                done({ error: typeof parsed.error === 'string' ? parsed.error : 'Grant refused' })
            } catch {
                done({ error: 'Invalid grant response' })
            }
        })
    })
}

function readGrantServerCredentials(socket: Socket): PeerCredentials | null {
    if (process.platform === 'win32') {
        return readWindowsNamedPipeServerCredentials(socket)
    }
    return readUnixPeerCredentials(socket)
}

function defaultGrantSocketPath(): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\hapi-lrg-${randomBytes(12).toString('hex')}`
    }
    const runtime = process.env.XDG_RUNTIME_DIR?.trim()
        || join(tmpdir(), `hapi-${process.getuid?.() ?? process.pid}`)
    return join(runtime, 'lrg', `${randomBytes(12).toString('hex')}.sock`)
}
