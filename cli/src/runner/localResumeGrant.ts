/**
 * Peercred-authenticated local resume grant socket (#1473 Major).
 *
 * Terminal `hapi resume` has no HAPI_PEER_CAP_INJECT. Tracked session
 * children may redeem a peercred grant here. Unrelated operator shells fail
 * closed (accepted residual until operator-trusted remap / #1486).
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
     * session id — minting is restricted to it.
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
                        // Only a process in the target session's tracked tree may
                        // mint that session's capability. Operator terminals use
                        // the runner HTTP control path when no sessions are
                        // tracked (#1473 Blocker — cmdline is forgeable).
                        if (tracked !== sessionId) {
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
    // No HTTP loopback mint (#1473 Blocker): same-UID helpers could forge it.
    // Operator / Windows terminal resume continues unattributed instead.
    throw new Error(
        'No peercred local-resume grant '
        + '(tracked session trees only; terminal resume stays unattributed)'
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
