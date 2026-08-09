import { randomBytes } from 'node:crypto'
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { mkdirSync, unlinkSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { isProcessDescendant } from './processDescendant'
import { readUnixPeerCredentials, type PeerCredReader } from './peercred'

export const HAPI_PEER_CAP_INJECT_ENV = 'HAPI_PEER_CAP_INJECT'

/**
 * Runner → session-CLI capability handoff (#1203 pass 2h).
 *
 * Runner listens; child connects. Auth = peer credentials and the peer pid
 * must be the spawned session CLI (or a descendant). Sibling session CLIs are
 * cousins under the runner — not descendants of each other.
 */

export type PeerCapabilityInjectServer = {
    path: string
    /** Arm delivery for a specific child pid, then wait until that child connects. */
    deliverTo: (childPid: number, capability: string) => Promise<void>
    close: () => void
}

export function startPeerCapabilityInjectServer(options?: {
    readPeerCred?: PeerCredReader
    socketPath?: string
}): PeerCapabilityInjectServer {
    const readPeerCred = options?.readPeerCred ?? readUnixPeerCredentials
    const socketPath = options?.socketPath ?? defaultInjectSocketPath()
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
    if (existsSync(socketPath)) {
        try {
            unlinkSync(socketPath)
        } catch {
            // replace
        }
    }

    let expectedChildPid: number | null = null
    let pendingCapability: string | null = null
    let deliverResolve: (() => void) | null = null
    let deliverReject: ((error: Error) => void) | null = null
    let deliverTimer: ReturnType<typeof setTimeout> | null = null

    const server: Server = createServer((socket) => {
        const cred = readPeerCred(socket)
        const childPid = expectedChildPid
        const capability = pendingCapability
        if (
            !cred
            || childPid === null
            || !capability
            || !isProcessDescendant(cred.pid, childPid)
        ) {
            socket.end(`${JSON.stringify({ ok: false, code: 'auth_failed' })}\n`)
            return
        }
        socket.end(`${JSON.stringify({ ok: true, sessionCapability: capability })}\n`)
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
    server.listen(socketPath)
    try {
        chmodSync(socketPath, 0o600)
    } catch {
        // best-effort
    }

    return {
        path: socketPath,
        deliverTo: (childPid, capability) => new Promise<void>((resolve, reject) => {
            expectedChildPid = childPid
            pendingCapability = capability
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
            server.close()
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
    const readPeerCred = options?.readPeerCred ?? readUnixPeerCredentials
    const ownerPid = options?.ownerPid ?? process.pid
    // Align with runner deliverTo timeout (15s) plus redeem latency.
    const attempts = options?.attempts ?? 160

    for (let i = 0; i < attempts; i++) {
        const capability = await tryReceiveOnce(socketPath, readPeerCred, ownerPid)
        if (capability) {
            return capability
        }
        await new Promise((r) => setTimeout(r, 100))
    }
    logger.debug('[peer-cap-inject] no capability received from runner')
    return undefined
}

function tryReceiveOnce(
    socketPath: string,
    readPeerCred: PeerCredReader,
    ownerPid: number
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
                    }
                    finish(
                        parsed.ok && typeof parsed.sessionCapability === 'string'
                            ? parsed.sessionCapability.trim() || undefined
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
            // Server pushes capability on accept when armed.
        })
    })
}

function defaultInjectSocketPath(): string {
    const runtime = process.env.XDG_RUNTIME_DIR?.trim()
        || join(configuration.happyHomeDir, 'run')
    return join(runtime, 'hapi-peer-cap-inject', `${randomBytes(16).toString('hex')}.sock`)
}
