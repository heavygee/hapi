import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { constantTimeEquals } from '../../../utils/crypto'
import { mintPeerSessionCapability } from '../../../web/peerCapability'
import { registerMachineHandlers } from './machineHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'

type SessionAlivePayload = {
    sid: string
    time: number
    thinking?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    collaborationMode?: CodexCollaborationMode
}

type SessionEndPayload = {
    sid: string
    time: number
}

type SessionReadyPayload = {
    sid: string
    time: number
}

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    /** Hub JWT secret — mints session-scoped peer-delivery capabilities on connect. */
    jwtSecret: Uint8Array
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionReady?: (payload: SessionReadyPayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onMachineAlive?: (payload: MachineAlivePayload) => void
    onWebappEvent?: (event: SyncEvent) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    onSweepImmediateQueued?: (sessionId: string, now: number) => void
    onMessagesConsumed?: (sessionId: string) => void
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, jwtSecret, onSessionAlive, onSessionReady, onSessionEnd, onMachineAlive, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, onSweepImmediateQueued, onMessagesConsumed } = deps
    const terminalNamespace = io.of('/terminal')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const resolveSessionAccess = (sessionId: string): AccessResult<StoredSession> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const session = store.sessions.getSessionByNamespace(sessionId, namespace)
        if (session) {
            return { ok: true, value: session }
        }
        if (store.sessions.getSession(sessionId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const resolveMachineAccess = (machineId: string): AccessResult<StoredMachine> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const machine = store.machines.getMachineByNamespace(machineId, namespace)
        if (machine) {
            return { ok: true, value: machine }
        }
        if (store.machines.getMachine(machineId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    if (sessionId) {
        const access = resolveSessionAccess(sessionId)
        if (access.ok) {
            socket.join(`session:${sessionId}`)
            // Session-scoped RPC uses `${sessionId}:method` — authorize the
            // namespace-resolved session id so colon methods are not treated as
            // machine-only (#1473 Major).
            socket.data.sessionRpcAuthorizedId = sessionId
            // Capability mint requires the create-time session tag — unavailable
            // to sibling sessions that share only the namespace CLI token.
            // Resume mints are redeemed by the runner with a spawn-RPC nonce
            // (pass 2h B1) — never on first /cli connect (TOCTOU).
            const presentedTag = typeof auth?.sessionTag === 'string' ? auth.sessionTag : ''
            const storedTag = typeof access.value.tag === 'string' ? access.value.tag : ''
            if (presentedTag && storedTag && constantTimeEquals(presentedTag, storedTag)) {
                socket.emit('peer-capability', {
                    sessionId,
                    sessionCapability: mintPeerSessionCapability(sessionId, jwtSecret)
                })
            }
        }
    }

    const machineId = typeof auth?.machineId === 'string' ? auth.machineId : null
    if (machineId) {
        const access = resolveMachineAccess(machineId)
        if (access.ok) {
            // Machine room + RPC require create-time machine tag (#1203 / #1473 B1).
            // Namespace token + machineId alone must not own spawn-happy-session.
            const presentedTag = typeof auth?.machineTag === 'string' ? auth.machineTag : ''
            const storedTag = typeof access.value.tag === 'string' ? access.value.tag : ''
            if (presentedTag && storedTag && constantTimeEquals(presentedTag, storedTag)) {
                socket.data.machineRpcAuthorizedId = machineId
                socket.join(`machine:${machineId}`)
            }
        }
    }

    const emitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => {
        const message = reason === 'access-denied'
            ? `${scope} access denied`
            : reason === 'not-found'
                ? `${scope} not found`
                : 'Namespace missing'
        socket.emit('error', { message, code: reason, scope, id })
    }

    registerRpcHandlers(socket, rpcRegistry)
    registerSessionHandlers(socket, {
        store,
        resolveSessionAccess,
        emitAccessError,
        onSessionAlive,
        onSessionReady,
        onSessionEnd,
        onWebappEvent,
        onBackgroundTaskDelta,
        onSessionActivity,
        onSweepImmediateQueued,
        onMessagesConsumed
    })
    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess,
        emitAccessError,
        onMachineAlive,
        onWebappEvent
    })
    registerTerminalHandlers(socket, {
        terminalRegistry,
        terminalNamespace,
        resolveSessionAccess,
        emitAccessError
    })

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
    })
}
