import { randomBytes } from 'node:crypto'
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { mkdirSync, unlinkSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@/ui/logger'
import { isProcessDescendant } from './processDescendant'
import { readUnixPeerCredentials, type PeerCredReader } from './peercred'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'
import {
    PingPeerError,
    pingPeer,
    type PingPeerResult,
} from '@/modules/pingPeer/pingPeer'

export const HAPI_PEER_DELIVER_BROKER_ENV = 'HAPI_PEER_DELIVER_BROKER'

type BrokerRequest = {
    op: 'ping-peer'
    sessionIdPrefix: string
    message: string
    waitActiveSecs?: number
}

type BrokerResponse =
    | { ok: true; result: PingPeerResult }
    | { ok: false; code: string; message: string }

export type PeerDeliverBrokerOptions = {
    sessionId: string
    sessionCapability: string
    ownerPid?: number
    readPeerCred?: PeerCredReader
    socketPath?: string
}

/**
 * Session-parent broker (#1203 pass 2d).
 *
 * Child `hapi ping-peer` asks this parent to deliver — the bearer capability
 * never leaves parent memory. Auth is SO_PEERCRED / LOCAL_PEERPID +
 * descendant-of-owner so a same-UID sibling session cannot drive another
 * session's provenance. Client also verifies the listener is an ancestor (M3).
 */
export class PeerDeliverBroker {
    readonly socketPath: string
    private readonly sessionId: string
    private readonly sessionCapability: string
    private readonly ownerPid: number
    private readonly readPeerCred: PeerCredReader
    private server: Server | null = null

    constructor(options: PeerDeliverBrokerOptions) {
        this.sessionId = options.sessionId
        this.sessionCapability = options.sessionCapability
        this.ownerPid = options.ownerPid ?? process.pid
        this.readPeerCred = options.readPeerCred ?? readUnixPeerCredentials
        this.socketPath = options.socketPath ?? defaultBrokerSocketPath(options.sessionId)
    }

    start(): void {
        if (this.server) {
            return
        }
        mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 })
        if (existsSync(this.socketPath)) {
            try {
                unlinkSync(this.socketPath)
            } catch {
                // replace stale socket
            }
        }
        this.server = createServer((socket) => {
            void this.handleConnection(socket).catch((error) => {
                logger.debug('[peer-broker] connection failed', error)
                socket.destroy()
            })
        })
        this.server.once('error', (error) => {
            logger.debug(`[peer-broker] listen failed on ${this.socketPath}`, error)
            this.server = null
            if (process.env[HAPI_PEER_DELIVER_BROKER_ENV] === this.socketPath) {
                delete process.env[HAPI_PEER_DELIVER_BROKER_ENV]
            }
        })
        this.server.listen(this.socketPath, () => {
            try {
                chmodSync(this.socketPath, 0o600)
            } catch {
                // best-effort
            }
            process.env[HAPI_PEER_DELIVER_BROKER_ENV] = this.socketPath
            logger.debug(`[peer-broker] listening on ${this.socketPath}`)
        })
    }

    stop(): void {
        const server = this.server
        this.server = null
        if (process.env[HAPI_PEER_DELIVER_BROKER_ENV] === this.socketPath) {
            delete process.env[HAPI_PEER_DELIVER_BROKER_ENV]
        }
        server?.close()
        try {
            unlinkSync(this.socketPath)
        } catch {
            // ignore
        }
    }

    private async handleConnection(socket: Socket): Promise<void> {
        const cred = this.readPeerCred(socket)
        if (!cred || !isProcessDescendant(cred.pid, this.ownerPid)) {
            socket.end(`${JSON.stringify({
                ok: false,
                code: 'auth_failed',
                message: 'peer deliver broker: caller is not a descendant of the session parent',
            } satisfies BrokerResponse)}\n`)
            return
        }

        const line = await readSocketLine(socket)
        let request: BrokerRequest
        try {
            request = JSON.parse(line) as BrokerRequest
        } catch {
            socket.end(`${JSON.stringify({
                ok: false,
                code: 'bad_args',
                message: 'invalid broker request',
            } satisfies BrokerResponse)}\n`)
            return
        }

        if (request.op !== 'ping-peer') {
            socket.end(`${JSON.stringify({
                ok: false,
                code: 'bad_args',
                message: `unsupported broker op: ${String(request.op)}`,
            } satisfies BrokerResponse)}\n`)
            return
        }

        try {
            const result = await pingPeer({
                sessionIdPrefix: request.sessionIdPrefix,
                message: request.message,
                waitActiveSecs: request.waitActiveSecs,
                authenticatedSourceSessionId: this.sessionId,
                sessionCapability: this.sessionCapability,
            })
            socket.end(`${JSON.stringify({ ok: true, result } satisfies BrokerResponse)}\n`)
        } catch (error) {
            if (error instanceof PingPeerError) {
                socket.end(`${JSON.stringify({
                    ok: false,
                    code: error.code,
                    message: error.message,
                } satisfies BrokerResponse)}\n`)
                return
            }
            socket.end(`${JSON.stringify({
                ok: false,
                code: 'send_failed',
                message: error instanceof Error ? error.message : String(error),
            } satisfies BrokerResponse)}\n`)
        }
    }
}

/** Portable pathname budget (macOS ~104 incl NUL; Linux 108). */
export const MAX_UNIX_SOCKET_PATH_BYTES = 103

/**
 * Short opaque path under a private runtime root (#1473 Major).
 * Session id is not embedded — path is exported via env; peercred auth is PID-based.
 */
export function defaultBrokerSocketPath(_sessionId?: string): string {
    const runtime = process.env.XDG_RUNTIME_DIR?.trim()
        || join(tmpdir(), `hapi-${process.getuid?.() ?? process.pid}`)
    return join(runtime, 'pd', `${randomBytes(12).toString('hex')}.sock`)
}

function readSocketLine(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const onData = (data: Buffer | string) => {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
            const combined = Buffer.concat(chunks)
            const newline = combined.indexOf(0x0a)
            if (newline >= 0) {
                cleanup()
                resolve(combined.subarray(0, newline).toString('utf8').trim())
            }
        }
        const onError = (error: Error) => {
            cleanup()
            reject(error)
        }
        const onEnd = () => {
            cleanup()
            reject(new Error('broker socket closed before request line'))
        }
        const cleanup = () => {
            socket.off('data', onData)
            socket.off('error', onError)
            socket.off('end', onEnd)
        }
        socket.on('data', onData)
        socket.on('error', onError)
        socket.on('end', onEnd)
    })
}

/** Child-side: ask the session parent to deliver an attributed ping. */
export async function requestParentPeerDeliver(options: {
    sessionIdPrefix: string
    message: string
    waitActiveSecs?: number
    socketPath?: string
    readPeerCred?: PeerCredReader
}): Promise<PingPeerResult> {
    const socketPath = options.socketPath
        ?? process.env[HAPI_PEER_DELIVER_BROKER_ENV]?.trim()
    if (!socketPath) {
        throw new PingPeerError(
            'broker_unavailable',
            'inside a wrapped session but peer deliver broker is unavailable; use MCP ping_peer or retry after session parent is ready'
        )
    }
    if (!process.env[HAPI_SESSION_ID_ENV]?.trim()) {
        throw new PingPeerError('auth_failed', 'HAPI_SESSION_ID missing for attributed peer delivery')
    }

    const readPeerCred = options.readPeerCred ?? readUnixPeerCredentials

    const response = await new Promise<BrokerResponse>((resolve, reject) => {
        const chunks: Buffer[] = []
        const socket = createConnection(socketPath)
        socket.on('data', (data) => {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
            if (Buffer.concat(chunks).includes(0x0a)) {
                socket.end()
            }
        })
        socket.on('error', (error) => {
            reject(new PingPeerError(
                'broker_unavailable',
                `peer deliver broker connect failed: ${error.message}`
            ))
        })
        socket.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as BrokerResponse)
            } catch (error) {
                reject(error)
            }
        })
        socket.on('connect', () => {
            // M3: verify the listener is an ancestor of this process so a
            // same-UID sibling cannot unlink+rebind the socket path and
            // silently intercept outgoing peer text.
            const cred = readPeerCred(socket)
            if (!cred || !isProcessDescendant(process.pid, cred.pid)) {
                const err = new PingPeerError(
                    'auth_failed',
                    'peer deliver broker: listener is not an ancestor of this process'
                )
                socket.removeAllListeners()
                socket.on('error', () => {
                    // ignore follow-on reset after we drop a forged listener
                })
                socket.end()
                reject(err)
                return
            }
            const body: BrokerRequest = {
                op: 'ping-peer',
                sessionIdPrefix: options.sessionIdPrefix,
                message: options.message,
                waitActiveSecs: options.waitActiveSecs,
            }
            socket.write(`${JSON.stringify(body)}\n`)
        })
    })

    if (!response.ok) {
        const code = response.code === 'bad_args'
            || response.code === 'auth_failed'
            || response.code === 'broker_unavailable'
            || response.code === 'not_found'
            || response.code === 'ambiguous'
            || response.code === 'resume_failed'
            || response.code === 'timeout'
            || response.code === 'send_failed'
            ? response.code
            : 'send_failed'
        throw new PingPeerError(code, response.message)
    }
    return response.result
}
