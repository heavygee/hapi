import { randomBytes } from 'node:crypto'
import { createServer, createConnection, type Server } from 'node:net'
import { mkdirSync, unlinkSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@/ui/logger'
import { isProcessDescendant } from './processDescendant'
import { readUnixPeerCredentials, type PeerCredReader } from './peercred'

export const HAPI_PEER_CAP_INJECT_ENV = 'HAPI_PEER_CAP_INJECT'
/** Opaque socket path only — never put the proof itself in env (#1473). */
export const HAPI_RUNNER_HANDOFF_SOCKET_ENV = 'HAPI_RUNNER_HANDOFF_SOCKET'

/**
 * Runner → child secret handoff (#1203 pass 2h / #1473).
 *
 * Runner listens; child connects. Auth = peer credentials and the peer pid
 * must be the spawned child (or a descendant). Sibling processes are cousins
 * under a common parent — not descendants of each other.
 */

export type InjectSecretPayload =
    | { sessionCapability: string }
    | { runnerProof: string }

export type PeerCapabilityInjectServer = {
    path: string
    /** Arm delivery for a specific child pid, then wait until that child connects. */
    deliverTo: (childPid: number, payload: InjectSecretPayload) => Promise<void>
    close: () => void
}

export async function startPeerCapabilityInjectServer(options?: {
    readPeerCred?: PeerCredReader
    socketPath?: string
}): Promise<PeerCapabilityInjectServer | null> {
    // peercred is Linux/macOS only; fail soft so resume stays unattributed (#1473).
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
        return null
    }

    const readPeerCred = options?.readPeerCred ?? readUnixPeerCredentials
    const socketPath = options?.socketPath ?? defaultInjectSocketPath()

    let expectedChildPid: number | null = null
    let pendingPayload: InjectSecretPayload | null = null
    let deliverResolve: (() => void) | null = null
    let deliverReject: ((error: Error) => void) | null = null
    let deliverTimer: ReturnType<typeof setTimeout> | null = null
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
            const childPid = expectedChildPid
            const payload = pendingPayload
            if (
                !cred
                || childPid === null
                || !payload
                || !isProcessDescendant(cred.pid, childPid)
            ) {
                socket.end(`${JSON.stringify({ ok: false, code: 'auth_failed' })}\n`)
                return
            }
            socket.end(`${JSON.stringify({ ok: true, ...payload })}\n`)
            if (deliverResolve) {
                if (deliverTimer) {
                    clearTimeout(deliverTimer)
                    deliverTimer = null
                }
                const resolve = deliverResolve
                deliverResolve = null
                deliverReject = null
                resolve()
            }
        })

        await new Promise<void>((resolve, reject) => {
            server!.once('error', reject)
            server!.listen(socketPath, resolve)
        })
    } catch (error) {
        logger.debug('[peer-cap-inject] listen failed; resume will be unattributed', error)
        server?.close()
        try {
            unlinkSync(socketPath)
        } catch {
            // ignore
        }
        return null
    }

    const listening = server

    try {
        chmodSync(socketPath, 0o600)
    } catch {
        // best-effort
    }

    return {
        path: socketPath,
        deliverTo: (childPid, payload) => new Promise<void>((resolve, reject) => {
            expectedChildPid = childPid
            pendingPayload = payload
            deliverResolve = resolve
            deliverReject = reject
            deliverTimer = setTimeout(() => {
                if (deliverReject) {
                    const rej = deliverReject
                    deliverResolve = null
                    deliverReject = null
                    rej(new Error('peer capability inject timed out waiting for session CLI'))
                }
            }, 15_000)
        }),
        close: () => {
            if (deliverTimer) {
                clearTimeout(deliverTimer)
                deliverTimer = null
            }
            listening.close()
            try {
                unlinkSync(socketPath)
            } catch {
                // ignore
            }
            if (deliverReject) {
                const rej = deliverReject
                deliverResolve = null
                deliverReject = null
                rej(new Error('peer capability inject closed'))
            }
        },
    }
}

/** Child-side: pull capability from the runner inject socket (retries while runner arms). */
export async function receivePeerCapabilityFromRunner(options?: {
    socketPath?: string
    readPeerCred?: PeerCredReader
    ownerPid?: number
    attempts?: number
}): Promise<string | undefined> {
    const socketPath = options?.socketPath
        ?? process.env[HAPI_PEER_CAP_INJECT_ENV]?.trim()
    if (!socketPath) {
        return undefined
    }
    delete process.env[HAPI_PEER_CAP_INJECT_ENV]
    return await receiveInjectedField('sessionCapability', {
        ...options,
        socketPath,
    })
}

/**
 * Child-side runner handoff: pull memory-only runnerProof from a PID-checked
 * socket. Only the socket path may appear in env (#1473 Major).
 */
export async function receiveRunnerProofFromHandoff(options?: {
    socketPath?: string
    readPeerCred?: PeerCredReader
    ownerPid?: number
    attempts?: number
}): Promise<string | undefined> {
    const socketPath = options?.socketPath
        ?? process.env[HAPI_RUNNER_HANDOFF_SOCKET_ENV]?.trim()
    if (!socketPath) {
        return undefined
    }
    delete process.env[HAPI_RUNNER_HANDOFF_SOCKET_ENV]
    return await receiveInjectedField('runnerProof', {
        ...options,
        socketPath,
        // Handoff is brief; fewer retries than resume inject.
        attempts: options?.attempts ?? 50,
    })
}

async function receiveInjectedField(
    field: 'sessionCapability' | 'runnerProof',
    options: {
        socketPath: string
        readPeerCred?: PeerCredReader
        ownerPid?: number
        attempts?: number
    }
): Promise<string | undefined> {
    const readPeerCred = options.readPeerCred ?? readUnixPeerCredentials
    const ownerPid = options.ownerPid ?? process.pid
    const attempts = options.attempts ?? 160

    for (let i = 0; i < attempts; i++) {
        const value = await tryReceiveOnce(options.socketPath, readPeerCred, ownerPid, field)
        if (value) {
            return value
        }
        await new Promise((r) => setTimeout(r, 100))
    }
    logger.debug(`[peer-cap-inject] no ${field} received from handoff socket`)
    return undefined
}

function tryReceiveOnce(
    socketPath: string,
    readPeerCred: PeerCredReader,
    ownerPid: number,
    field: 'sessionCapability' | 'runnerProof'
): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        const chunks: Buffer[] = []
        const socket = createConnection(socketPath)
        const finish = (value: string | undefined) => {
            socket.removeAllListeners()
            socket.on('error', () => {})
            try {
                socket.end()
            } catch {
                // ignore
            }
            resolve(value)
        }
        socket.on('error', () => finish(undefined))
        socket.on('data', (data) => {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
            if (Buffer.concat(chunks).includes(0x0a)) {
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as {
                        ok?: boolean
                        sessionCapability?: string
                        runnerProof?: string
                    }
                    const value = parsed[field]
                    finish(
                        parsed.ok && typeof value === 'string'
                            ? value.trim() || undefined
                            : undefined
                    )
                } catch {
                    finish(undefined)
                }
            }
        })
        socket.on('connect', () => {
            const cred = readPeerCred(socket)
            if (!cred || !isProcessDescendant(ownerPid, cred.pid)) {
                finish(undefined)
            }
            // Server pushes secret on accept when armed.
        })
    })
}

function defaultInjectSocketPath(): string {
    const runtime = process.env.XDG_RUNTIME_DIR?.trim()
        || join(tmpdir(), `hapi-${process.getuid?.() ?? process.pid}`)
    return join(runtime, 'pci', `${randomBytes(12).toString('hex')}.sock`)
}
