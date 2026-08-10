/**
 * Peercred-authenticated local resume grant socket (#1473 Major).
 *
 * Terminal `hapi resume` has no HAPI_PEER_CAP_INJECT. It connects here; the
 * runner verifies same-UID peer credentials, then mints a session capability
 * via the hub using its live runnerProof.
 */

import { createServer, createConnection, type Server } from 'node:net'
import { mkdirSync, unlinkSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@/ui/logger'
import { readUnixPeerCredentials, type PeerCredReader } from '@/api/peercred'
import { configuration } from '@/configuration'

export type LocalResumeGrantServer = {
    path: string
    close: () => void
}

function defaultSocketPath(): string {
    return join(configuration.happyHomeDir, 'local-resume.sock')
}

export async function startLocalResumeGrantServer(options: {
    mintCapability: (sessionId: string) => Promise<string>
    /**
     * If the peer PID belongs to a tracked session process tree, return that
     * session id — minting is restricted to it. Return null for operator
     * terminals (not under a tracked child). (#1473 Blocker)
     */
    resolveTrackedSessionId?: (peerPid: number) => string | null
    readPeerCred?: PeerCredReader
    socketPath?: string
}): Promise<LocalResumeGrantServer | null> {
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
        // Windows: peercred equivalent is weaker; terminal resume falls back
        // to the runner HTTP control path with loopback trust.
        return null
    }

    const readPeerCred = options.readPeerCred ?? readUnixPeerCredentials
    const socketPath = options.socketPath ?? defaultSocketPath()
    const runnerUid = typeof process.getuid === 'function' ? process.getuid() : -1
    if (runnerUid < 0) {
        return null
    }

    let server: Server | null = null
    try {
        mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
        if (existsSync(socketPath)) {
            try {
                unlinkSync(socketPath)
            } catch {
                // replace
            }
        }

        server = createServer((socket) => {
            const cred = readPeerCred(socket)
            if (!cred || cred.uid !== runnerUid) {
                socket.end(`${JSON.stringify({ ok: false, code: 'auth_failed' })}\n`)
                return
            }
            let buffered = ''
            socket.setEncoding('utf8')
            socket.on('data', (chunk) => {
                buffered += chunk
                const newline = buffered.indexOf('\n')
                if (newline < 0) {
                    return
                }
                const line = buffered.slice(0, newline).trim()
                buffered = buffered.slice(newline + 1)
                void (async () => {
                    try {
                        const parsed = JSON.parse(line) as { sessionId?: unknown }
                        const sessionId = typeof parsed.sessionId === 'string'
                            ? parsed.sessionId.trim()
                            : ''
                        if (!sessionId) {
                            socket.end(`${JSON.stringify({ ok: false, code: 'bad_request' })}\n`)
                            return
                        }
                        const tracked = options.resolveTrackedSessionId?.(cred.pid) ?? null
                        if (tracked && tracked !== sessionId) {
                            // Session A must not mint session B's capability.
                            socket.end(`${JSON.stringify({ ok: false, code: 'auth_failed' })}\n`)
                            return
                        }
                        const sessionCapability = await options.mintCapability(sessionId)
                        socket.end(`${JSON.stringify({ ok: true, sessionCapability })}\n`)
                    } catch (error) {
                        logger.debug('[local-resume-grant] mint failed', error)
                        socket.end(`${JSON.stringify({
                            ok: false,
                            code: 'mint_failed',
                            error: error instanceof Error ? error.message : String(error),
                        })}\n`)
                    }
                })()
            })
        })

        await new Promise<void>((resolve, reject) => {
            server!.once('error', reject)
            server!.listen(socketPath, () => {
                try {
                    chmodSync(socketPath, 0o600)
                } catch {
                    // best effort
                }
                resolve()
            })
        })
    } catch (error) {
        logger.debug('[local-resume-grant] listen failed', error)
        server?.close()
        try {
            unlinkSync(socketPath)
        } catch {
            // ignore
        }
        return null
    }

    return {
        path: socketPath,
        close: () => {
            server?.close()
            try {
                unlinkSync(socketPath)
            } catch {
                // ignore
            }
        },
    }
}

export async function requestRunnerLocalResumeCapability(sessionId: string): Promise<string> {
    const { readRunnerState } = await import('@/persistence')
    const state = await readRunnerState()
    const socketPath = typeof state?.localResumeSocket === 'string'
        ? state.localResumeSocket.trim()
        : ''
    if (socketPath) {
        const capability = await requestViaUnixSocket(socketPath, sessionId)
        if (capability) {
            return capability
        }
    }
    // Windows / missing peercred socket: HTTP control on loopback.
    if (state?.httpPort) {
        const { isProcessAlive } = await import('@/utils/process')
        if (!isProcessAlive(state.pid)) {
            throw new Error('Runner is not running')
        }
        const timeout = process.env.HAPI_RUNNER_HTTP_TIMEOUT
            ? parseInt(process.env.HAPI_RUNNER_HTTP_TIMEOUT, 10)
            : 10_000
        const response = await fetch(`http://127.0.0.1:${state.httpPort}/prepare-local-resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
            signal: AbortSignal.timeout(timeout),
        })
        if (!response.ok) {
            throw new Error(`Runner local-resume grant failed: HTTP ${response.status}`)
        }
        const body = await response.json() as { sessionCapability?: string; error?: string }
        const capability = typeof body.sessionCapability === 'string'
            ? body.sessionCapability.trim()
            : ''
        if (!capability) {
            throw new Error(body.error?.trim() || 'Runner local-resume grant returned no capability')
        }
        return capability
    }
    throw new Error(
        'No live runner for secure local resume '
        + '(start `hapi runner start`, or resume from the web UI)'
    )
}

async function requestViaUnixSocket(socketPath: string, sessionId: string): Promise<string | null> {
    return await new Promise((resolve) => {
        const socket = createConnection(socketPath)
        let buffered = ''
        const timer = setTimeout(() => {
            socket.destroy()
            resolve(null)
        }, 10_000)
        socket.setEncoding('utf8')
        socket.on('connect', () => {
            socket.write(`${JSON.stringify({ sessionId })}\n`)
        })
        socket.on('data', (chunk) => {
            buffered += chunk
            const newline = buffered.indexOf('\n')
            if (newline < 0) {
                return
            }
            clearTimeout(timer)
            try {
                const parsed = JSON.parse(buffered.slice(0, newline)) as {
                    ok?: boolean
                    sessionCapability?: string
                }
                const capability = typeof parsed.sessionCapability === 'string'
                    ? parsed.sessionCapability.trim()
                    : ''
                resolve(parsed.ok && capability ? capability : null)
            } catch {
                resolve(null)
            }
            socket.end()
        })
        socket.on('error', () => {
            clearTimeout(timer)
            resolve(null)
        })
    })
}

/** Test helper: tmpdir socket path under a unique prefix. */
export function testLocalResumeSocketPath(prefix: string): string {
    return join(tmpdir(), `${prefix}-${process.pid}.sock`)
}
