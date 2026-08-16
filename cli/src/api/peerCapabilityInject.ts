import { randomBytes } from 'node:crypto'
import { createServer, createConnection, type Server } from 'node:net'
import { mkdirSync, unlinkSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@/ui/logger'
import { isProcessDescendant } from './processDescendant'
import { readUnixPeerCredentials, type PeerCredentials, type PeerCredReader } from './peercred'

export const HAPI_PEER_CAP_INJECT_ENV = 'HAPI_PEER_CAP_INJECT'
/** Opaque socket path only — never put the proof itself in env (#1473). */
export const HAPI_RUNNER_HANDOFF_SOCKET_ENV = 'HAPI_RUNNER_HANDOFF_SOCKET'
/** Runner PID for Windows named-pipe server verification (#1473 Major). */
export const HAPI_PEER_CAP_INJECT_SERVER_PID_ENV = 'HAPI_PEER_CAP_INJECT_SERVER_PID'

/** In-process capability from peercred local-resume grant (never env). */
let pendingDirectResumeCapability: string | undefined

export function armDirectResumeCapability(capability: string): void {
    const trimmed = capability.trim()
    pendingDirectResumeCapability = trimmed || undefined
}

export function takeDirectResumeCapability(): string | undefined {
    const value = pendingDirectResumeCapability
    pendingDirectResumeCapability = undefined
    return value
}

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
    // Linux/macOS: SO_PEERCRED / getpeereid. Windows: named pipe + GetNamedPipeClientProcessId.
    if (
        process.platform !== 'linux'
        && process.platform !== 'darwin'
        && process.platform !== 'win32'
    ) {
        return null
    }

    const readPeerCred = options?.readPeerCred
        ?? (process.platform === 'win32' ? readWindowsNamedPipeClientCredentials : readUnixPeerCredentials)
    const socketPath = options?.socketPath ?? defaultInjectSocketPath()

    let expectedChildPid: number | null = null
    let pendingPayload: InjectSecretPayload | null = null
    let deliverResolve: (() => void) | null = null
    let deliverReject: ((error: Error) => void) | null = null
    let deliverTimer: ReturnType<typeof setTimeout> | null = null
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
            // Child often connects before redeem+deliverTo arms payload
            // (#1473 estate: early auth_failed exhausts retries → inject failed
            // even when redeem HTTP 200). Hold the socket until armed or timeout.
            const startedAt = Date.now()
            const maxWaitMs = 16_000
            const tryDeliver = () => {
                if (socket.destroyed) {
                    return
                }
                const childPid = expectedChildPid
                const payload = pendingPayload
                if (childPid === null || !payload) {
                    if (Date.now() - startedAt >= maxWaitMs) {
                        socket.end(`${JSON.stringify({ ok: false, code: 'not_armed' })}\n`)
                        return
                    }
                    setTimeout(tryDeliver, 20)
                    return
                }
                const cred = readPeerCred(socket)
                if (!authorizePeerCapInjectClient(cred, childPid)) {
                    socket.end(`${JSON.stringify({ ok: false, code: 'auth_failed' })}\n`)
                    return
                }
                // Do not resolve deliverTo if the client already abandoned this
                // socket (null peercred race → client finish(undefined) while we
                // still held). Resolving here unlinks the sock and the real
                // retry hits ENOENT (#1473 estate).
                if (socket.destroyed) {
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
            }
            tryDeliver()
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

    if (process.platform !== 'win32') {
        try {
            chmodSync(socketPath, 0o600)
        } catch {
            // best-effort
        }
    }

    return {
        path: socketPath,
        deliverTo: (childPid, payload) => new Promise<void>((resolve, reject) => {
            expectedChildPid = childPid
            pendingPayload = payload
            deliverResolve = resolve
            deliverReject = reject
            // Keep above child receivePeerCapabilityFromRunner attempts (~16s)
            // and aligned with runner webhook default (25s).
            deliverTimer = setTimeout(() => {
                if (deliverReject) {
                    const rej = deliverReject
                    deliverResolve = null
                    deliverReject = null
                    rej(new Error('peer capability inject timed out waiting for session CLI'))
                }
            }, 20_000)
        }),
        close: () => {
            if (deliverTimer) {
                clearTimeout(deliverTimer)
                deliverTimer = null
            }
            listening.close()
            if (process.platform !== 'win32') {
                try {
                    unlinkSync(socketPath)
                } catch {
                    // ignore
                }
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
    const serverPidRaw = process.env[HAPI_PEER_CAP_INJECT_SERVER_PID_ENV]?.trim()
    delete process.env[HAPI_PEER_CAP_INJECT_SERVER_PID_ENV]
    const expectedServerPid = serverPidRaw && /^\d+$/.test(serverPidRaw)
        ? Number(serverPidRaw)
        : undefined
    return await receiveInjectedField('sessionCapability', {
        ...options,
        socketPath,
        expectedServerPid,
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
    const handoffFromPidRaw = process.env.HAPI_RUNNER_HANDOFF_FROM_PID?.trim()
    const expectedServerPid = handoffFromPidRaw && /^\d+$/.test(handoffFromPidRaw)
        ? Number(handoffFromPidRaw)
        : undefined
    return await receiveInjectedField('runnerProof', {
        ...options,
        socketPath,
        // Handoff is brief; fewer retries than resume inject.
        attempts: options?.attempts ?? 50,
        expectedServerPid,
    })
}

async function receiveInjectedField(
    field: 'sessionCapability' | 'runnerProof',
    options: {
        socketPath: string
        readPeerCred?: PeerCredReader
        ownerPid?: number
        expectedServerPid?: number
        attempts?: number
    }
): Promise<string | undefined> {
    const readPeerCred = options.readPeerCred
        ?? (process.platform === 'win32'
            ? readWindowsNamedPipeServerCredentials
            : readUnixPeerCredentials)
    const ownerPid = options.ownerPid ?? process.pid
    const attempts = options.attempts ?? 160

    for (let i = 0; i < attempts; i++) {
        const value = await tryReceiveOnce(
            options.socketPath,
            readPeerCred,
            ownerPid,
            field,
            options.expectedServerPid
        )
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
    field: 'sessionCapability' | 'runnerProof',
    expectedServerPid?: number
): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        const chunks: Buffer[] = []
        const socket = createConnection(socketPath)
        let settled = false
        const finish = (value: string | undefined) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            socket.removeAllListeners()
            socket.on('error', () => {})
            try {
                socket.destroy()
            } catch {
                // ignore
            }
            resolve(value)
        }
        // Accept + clean close without a newline emits end/close, not error.
        // Bound silence so the outer retry loop can continue (#1473 Codex).
        const timer = setTimeout(() => finish(undefined), 1_000)
        socket.on('error', () => finish(undefined))
        socket.on('end', () => finish(undefined))
        socket.on('close', () => finish(undefined))
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
                    if (!parsed.ok || typeof value !== 'string' || !value.trim()) {
                        finish(undefined)
                        return
                    }
                    // Re-check peercred before accepting secrets — connect-time
                    // null cred must not bypass server auth (#1473 Codex Major).
                    const cred = readPeerCred(socket)
                    if (expectedServerPid !== undefined) {
                        if (!cred || cred.pid !== expectedServerPid) {
                            finish(undefined)
                            return
                        }
                    } else if (!cred || !isProcessDescendant(ownerPid, cred.pid)) {
                        finish(undefined)
                        return
                    }
                    finish(value.trim())
                } catch {
                    finish(undefined)
                }
            }
        })
        socket.on('connect', () => {
            const cred = readPeerCred(socket)
            // Hard-reject a wrong peer immediately. Missing cred may be a brief
            // Bun SO_PEERCRED race — data handler re-checks before accepting.
            if (expectedServerPid !== undefined) {
                if (cred && cred.pid !== expectedServerPid) {
                    finish(undefined)
                }
                return
            }
            if (cred && !isProcessDescendant(ownerPid, cred.pid)) {
                finish(undefined)
            }
        })
    })
}

/**
 * Authorize a peer-cap inject client for an armed `deliverTo(childPid, …)`.
 *
 * Requires peer credentials (SO_PEERCRED / GetNamedPipeClientProcessId) and a
 * descendant of `expectedChildPid`. Fail closed when credentials are missing —
 * including Bun-on-Windows where named-pipe `_handle.fd === -1` so client pid
 * cannot be read. Possession of an enumerable `\\.\pipe\*` path is not auth
 * (#1473 cold Major); Windows then stays unattributed until peercred works.
 */
export function authorizePeerCapInjectClient(
    cred: PeerCredentials | null,
    expectedChildPid: number,
    _platform: NodeJS.Platform = process.platform,
): boolean {
    if (!cred) {
        return false
    }
    return isProcessDescendant(cred.pid, expectedChildPid)
}

/** Windows client → verify named-pipe server PID (#1473 Major). */
export const readWindowsNamedPipeServerCredentials: PeerCredReader = (socket) => {
    try {
        const handleObj = (socket as unknown as {
            _handle?: { fd?: number | bigint; handle?: number | bigint }
        })._handle
        const raw = handleObj?.fd ?? handleObj?.handle
        if (raw === undefined || raw === null) {
            return null
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { dlopen, ptr } = require('bun:ffi') as typeof import('bun:ffi')
        const kernel32 = dlopen('kernel32.dll', {
            GetNamedPipeServerProcessId: {
                args: ['ptr', 'ptr'] as const,
                returns: 'i32',
            },
        })
        const pidBuf = new Uint32Array(1)
        const pipeHandle = typeof raw === 'bigint' ? raw : BigInt(Number(raw))
        // Kernel32 expects the HANDLE value itself, not a pointer to a buffer (#1473).
        const ok = kernel32.symbols.GetNamedPipeServerProcessId(
            pipeHandle as unknown as import('bun:ffi').Pointer,
            ptr(pidBuf),
        )
        if (!ok) {
            return null
        }
        const pid = pidBuf[0]!
        if (!Number.isInteger(pid) || pid <= 0) {
            return null
        }
        return { pid, uid: 0, gid: 0 } satisfies PeerCredentials
    } catch {
        return null
    }
}

function defaultInjectSocketPath(): string {
    if (process.platform === 'win32') {
        // Bun/Node named-pipe path; random suffix defeats squatting (#1473).
        return `\\\\.\\pipe\\hapi-pci-${randomBytes(12).toString('hex')}`
    }
    const runtime = process.env.XDG_RUNTIME_DIR?.trim()
        || join(tmpdir(), `hapi-${process.getuid?.() ?? process.pid}`)
    return join(runtime, 'pci', `${randomBytes(12).toString('hex')}.sock`)
}

/** Windows named-pipe peer pid via GetNamedPipeClientProcessId (#1473 Major). */
export const readWindowsNamedPipeClientCredentials: PeerCredReader = (socket) => {
    try {
        const handleObj = (socket as unknown as {
            _handle?: { fd?: number | bigint; handle?: number | bigint }
        })._handle
        const raw = handleObj?.fd ?? handleObj?.handle
        if (raw === undefined || raw === null) {
            return null
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { dlopen, ptr } = require('bun:ffi') as typeof import('bun:ffi')
        const kernel32 = dlopen('kernel32.dll', {
            GetNamedPipeClientProcessId: {
                // HANDLE is pointer-sized; pass the handle value as ptr.
                args: ['ptr', 'ptr'] as const,
                returns: 'i32',
            },
        })
        const pidBuf = new Uint32Array(1)
        const pipeHandle = typeof raw === 'bigint' ? raw : BigInt(Number(raw))
        // Kernel32 expects the HANDLE value itself, not a pointer to a buffer (#1473).
        const ok = kernel32.symbols.GetNamedPipeClientProcessId(
            pipeHandle as unknown as import('bun:ffi').Pointer,
            ptr(pidBuf),
        )
        if (!ok) {
            return null
        }
        const pid = pidBuf[0]!
        if (!Number.isInteger(pid) || pid <= 0) {
            return null
        }
        return { pid, uid: 0, gid: 0 }
    } catch {
        return null
    }
}
