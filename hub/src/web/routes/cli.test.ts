import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { HAPI_SESSION_CAPABILITY_HEADER } from '@hapi/protocol'
import type { SyncEngine } from '../../sync/syncEngine'
import { createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'
import { mintPeerSessionCapability } from '../peerCapability'
import {
    armResumePeerMint,
    clearResumePeerMintsForTests,
} from '../pendingResumePeerMint'
import { SessionIdentityConflictError } from '../../store/sessions'

const CLI_JWT_SECRET = new TextEncoder().encode('cli-route-test-secret')

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono()
    app.route('/cli', createCliRoutes(() => engine as SyncEngine, CLI_JWT_SECRET))
    return app
}

function authHeaders() {
    return {
        authorization: 'Bearer test-token'
    }
}

beforeAll(async () => {
    const config = await createConfiguration()
    config._setCliApiToken('test-token', 'env', false)
})

describe('cli resume routes', () => {
    it('returns local resumable sessions', async () => {
        const app = createApp({
            listLocalResumableSessions: () => [{
                sessionId: 'session-1',
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        } as never)

        const response = await app.request('/cli/sessions/resumable?machineId=machine-1', {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [{
                sessionId: 'session-1',
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        })
    })

    it('returns a local resume target', async () => {
        const app = createApp({
            resolveLocalResumeTarget: () => ({
                type: 'success',
                target: {
                    sessionId: 'session-1',
                    flavor: 'claude',
                    directory: '/tmp/project',
                    machineId: 'machine-1',
                    active: false,
                    thinking: false,
                    controlledByUser: false,
                    agentSessionId: '11111111-1111-4111-8111-111111111111'
                }
            })
        } as never)

        const response = await app.request('/cli/sessions/session-1/resume-target', {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            target: {
                sessionId: 'session-1',
                flavor: 'claude',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: '11111111-1111-4111-8111-111111111111'
            }
        })
    })

    it('returns handoff errors with status codes', async () => {
        const app = createApp({
            handoffSessionToLocal: async () => ({
                type: 'error',
                message: 'Session is already controlled by a local terminal',
                code: 'already_local'
            })
        } as never)

        const response = await app.request('/cli/sessions/session-1/handoff-local', {
            method: 'POST',
            headers: authHeaders()
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Session is already controlled by a local terminal',
            code: 'already_local'
        })
    })
})

describe('cli OpenCode clear route', () => {
    it.each(['confirm-cleanup', 'abort'] as const)('maps transient %s persistence failure to retryable 500', async (action) => {
        const failure = mock(() => ({
            type: 'error' as const,
            code: 'replacement_link_failed' as const,
            message: 'metadata write failed'
        }))
        const app = createApp(action === 'confirm-cleanup'
            ? { confirmOpenCodeClearCleanup: failure } as never
            : { abortOpenCodeClearSession: failure } as never)
        const response = await app.request(`/cli/sessions/source-session/clear-opencode/${action}`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ replacementSessionId: 'reserved-session' })
        })
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ code: 'replacement_link_failed' })
        expect(failure).toHaveBeenCalledWith('source-session', 'default', 'reserved-session')
    })

    it.each(['confirm-cleanup', 'abort'] as const)('requires reservation identity for %s', async (action) => {
        const app = createApp({} as never)
        const response = await app.request(`/cli/sessions/source-session/clear-opencode/${action}`, {
            method: 'POST', headers: authHeaders(), body: '{}'
        })
        expect(response.status).toBe(400)
    })

    it('durably reserves through the namespace-scoped engine route', async () => {
        const reserveOpenCodeClearSession = mock(() => ({ type: 'success' as const, sessionId: 'reserved-session' }))
        const app = createApp({ reserveOpenCodeClearSession } as never)
        const response = await app.request('/cli/sessions/source-session/clear-opencode/reserve', {
            method: 'POST', headers: authHeaders()
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, sessionId: 'reserved-session' })
        expect(reserveOpenCodeClearSession).toHaveBeenCalledWith('source-session', 'default')
    })

    it('orchestrates a fresh session only through the namespace-scoped engine route', async () => {
        const clearOpenCodeSession = mock(async () => ({ type: 'success' as const, sessionId: 'fresh-opencode-session' }))
        const app = createApp({ clearOpenCodeSession } as never)

        const response = await app.request('/cli/sessions/source-session/clear-opencode', {
            method: 'POST',
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, sessionId: 'fresh-opencode-session' })
        expect(clearOpenCodeSession).toHaveBeenCalledWith('source-session', 'default')
    })

    it('does not turn an active or wrong-flavor source into a new session', async () => {
        const app = createApp({
            clearOpenCodeSession: async () => ({
                type: 'error' as const,
                code: 'clear_unavailable' as const,
                message: 'Session must be an archived OpenCode clear source'
            })
        } as never)

        const response = await app.request('/cli/sessions/source-session/clear-opencode', {
            method: 'POST',
            headers: authHeaders()
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Session must be an archived OpenCode clear source',
            code: 'clear_unavailable'
        })
    })
})

describe('cli lazy session creation', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'

    it('creates the machine and requested session identity in one request', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            getMachine: () => null,
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: { path: '/tmp/project' },
                agentState: { controlledByUser: true },
                machine: {
                    id: 'machine-1',
                    metadata: { host: 'localhost' }
                }
            })
        })

        expect(response.status).toBe(200)
        expect(getOrCreateMachine).toHaveBeenCalledWith(
            'machine-1',
            { host: 'localhost' },
            null,
            'default',
            undefined,
            undefined
        )
        expect(getOrCreateSession).toHaveBeenCalledWith(
            'lazy-tag',
            { path: '/tmp/project' },
            { controlledByUser: true },
            'default',
            undefined,
            undefined,
            undefined,
            sessionId
        )
    })

    it('rejects an embedded machine owned by another namespace', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            getMachine: () => ({ id: 'machine-1', namespace: 'other' }),
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {},
                machine: { id: 'machine-1', metadata: {} }
            })
        })

        expect(response.status).toBe(403)
        expect(getOrCreateMachine).not.toHaveBeenCalled()
        expect(getOrCreateSession).not.toHaveBeenCalled()
    })

    it('returns 409 for a requested identity conflict', async () => {
        const app = createApp({
            getOrCreateSession: () => {
                throw new SessionIdentityConflictError('Session tag is already bound to a different id')
            }
        })

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {}
            })
        })

        expect(response.status).toBe(409)
    })
})

describe('POST /cli/sessions/:id/resume-peer-capability', () => {
    const sessionId = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'

    beforeEach(() => {
        clearResumePeerMintsForTests()
    })

    it('redeems an armed nonce into a capability (runner path)', async () => {
        const nonce = armResumePeerMint(sessionId)
        expect(nonce).toBeTruthy()
        const app = createApp({
            resolveSessionAccess: (id: string, _namespace: string) => (
                id === sessionId
                    ? {
                        ok: true as const,
                        sessionId,
                        session: { id: sessionId, active: false, metadata: { name: 'Resumed' } },
                    }
                    : { ok: false as const, reason: 'not-found' as const }
            ),
        } as never)

        const response = await app.request(`/cli/sessions/${sessionId}/resume-peer-capability`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce }),
        })
        expect(response.status).toBe(200)
        const body = await response.json() as { sessionCapability?: string }
        expect(body.sessionCapability).toBe(mintPeerSessionCapability(sessionId, CLI_JWT_SECRET))

        const replay = await app.request(`/cli/sessions/${sessionId}/resume-peer-capability`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce }),
        })
        expect(replay.status).toBe(403)
    })

    it('rejects wrong nonce even while a mint is armed', async () => {
        armResumePeerMint(sessionId)
        const app = createApp({
            resolveSessionAccess: (id: string) => (
                id === sessionId
                    ? {
                        ok: true as const,
                        sessionId,
                        session: { id: sessionId, active: false, metadata: { name: 'Resumed' } },
                    }
                    : { ok: false as const, reason: 'not-found' as const }
            ),
        } as never)
        const response = await app.request(`/cli/sessions/${sessionId}/resume-peer-capability`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce: 'not-the-armed-nonce' }),
        })
        expect(response.status).toBe(403)
    })
})

describe('GET /cli/sessions/:id peer capability surface', () => {
    it('does not return sessionCapability (resume uses runner nonce redeem)', async () => {
        const session = {
            id: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            active: true,
            metadata: { name: 'Resumed' },
        }
        const app = createApp({
            resolveSessionAccess: (id: string, _namespace: string) => (
                id === session.id
                    ? { ok: true as const, sessionId: session.id, session }
                    : { ok: false as const, reason: 'not-found' as const }
            ),
        } as never)

        const response = await app.request(`/cli/sessions/${session.id}`, {
            headers: authHeaders(),
        })
        expect(response.status).toBe(200)
        const body = await response.json() as Record<string, unknown>
        expect(body.session).toEqual(session)
        expect(body).not.toHaveProperty('sessionCapability')
    })
})

describe('POST /cli/sessions/:id/peer-messages', () => {
    const sourceId = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
    const targetId = '05d9f0f2-9273-4137-933c-07459a1146a2'
    const sourceCapability = mintPeerSessionCapability(sourceId, CLI_JWT_SECRET)

    function peerSessionsEngine(opts: {
        targetActive?: boolean
        sendMessage?: (sessionId: string, payload: unknown) => Promise<void>
    } = {}) {
        return {
            resolveSessionAccess: (id: string) => {
                if (id === sourceId) {
                    return {
                        ok: true as const,
                        sessionId: sourceId,
                        session: { id: sourceId, active: true, metadata: { name: 'Orchestrator' } }
                    }
                }
                if (id === targetId) {
                    return {
                        ok: true as const,
                        sessionId: targetId,
                        session: {
                            id: targetId,
                            active: opts.targetActive !== false,
                            metadata: { name: 'Target' }
                        }
                    }
                }
                return { ok: false as const, reason: 'not-found' as const }
            },
            sendMessage: opts.sendMessage ?? (async () => {
                throw new Error('should not send')
            })
        } as never
    }

    it('attributes peer delivery when path id matches session capability', async () => {
        const sentMessages: Array<{ sessionId: string; payload: unknown }> = []
        const app = createApp(peerSessionsEngine({
            sendMessage: async (sessionId, payload) => {
                sentMessages.push({ sessionId, payload })
            }
        }))

        const response = await app.request(`/cli/sessions/${sourceId}/peer-messages`, {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
                [HAPI_SESSION_CAPABILITY_HEADER]: sourceCapability
            },
            body: JSON.stringify({
                targetSessionId: targetId,
                text: 'handoff',
                peer: { sourceSessionId: targetId, sourceName: 'forged' }
            })
        })

        expect(response.status).toBe(200)
        expect(sentMessages).toEqual([{
            sessionId: targetId,
            payload: {
                text: 'handoff',
                localId: undefined,
                sentFrom: 'peer',
                peer: { sourceSessionId: sourceId, sourceName: 'Orchestrator' },
                deliveryMode: undefined
            }
        }])
    })

    it('rejects path source B when credential is for session A', async () => {
        const sentMessages: unknown[] = []
        const app = createApp(peerSessionsEngine({
            sendMessage: async (_sessionId, payload) => {
                sentMessages.push(payload)
            }
        }))
        const capabilityA = mintPeerSessionCapability(sourceId, CLI_JWT_SECRET)

        const response = await app.request(`/cli/sessions/${targetId}/peer-messages`, {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
                // Capability for A presented against path B — forge attempt.
                [HAPI_SESSION_CAPABILITY_HEADER]: capabilityA
            },
            body: JSON.stringify({ targetSessionId: sourceId, text: 'forged as B' })
        })

        expect(response.status).toBe(403)
        expect(sentMessages).toEqual([])
    })

    it('rejects attributed delivery without a session capability', async () => {
        const app = createApp(peerSessionsEngine({
            sendMessage: async () => {
                throw new Error('should not send')
            }
        }))

        const response = await app.request(`/cli/sessions/${sourceId}/peer-messages`, {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({ targetSessionId: targetId, text: 'handoff' })
        })

        expect(response.status).toBe(403)
    })

    it('rejects delivery when the target is inactive', async () => {
        const app = createApp(peerSessionsEngine({ targetActive: false }))

        const response = await app.request(`/cli/sessions/${sourceId}/peer-messages`, {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
                [HAPI_SESSION_CAPABILITY_HEADER]: sourceCapability
            },
            body: JSON.stringify({ targetSessionId: targetId, text: 'handoff' })
        })

        expect(response.status).toBe(409)
    })
})

describe('cli migrate-sessions', () => {
    it('rejects migrate from a pre-tag (untagged) source machine', async () => {
        const { hashRunnerProof } = await import('../../utils/runnerProof')
        const proof = 'runner-proof-legacy'
        const tag = 'dest-tag'
        const app = createApp({
            getMachineAuthMaterial: (id: string) => {
                if (id === 'new-machine') {
                    return {
                        namespace: 'default',
                        tag,
                        runnerProofHash: hashRunnerProof(proof),
                    }
                }
                if (id === 'old-machine') {
                    return {
                        namespace: 'default',
                        tag: null,
                        runnerProofHash: null,
                    }
                }
                return null
            },
            migrateSessionsMachineId: () => {
                throw new Error('should not migrate untagged source')
            },
        } as never)

        const response = await app.request('/cli/machines/new-machine/migrate-sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                fromMachineId: 'old-machine',
                machineTag: tag,
                runnerProof: proof,
                sourceRunnerProof: 'any-source-proof',
            }),
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Source machine continuity not proven' })
    })

    it('rejects migrate when a tagged source does not match destination tag', async () => {
        const { hashRunnerProof } = await import('../../utils/runnerProof')
        const proof = 'runner-proof-mismatch'
        const app = createApp({
            getMachineAuthMaterial: (id: string) => {
                if (id === 'new-machine') {
                    return {
                        namespace: 'default',
                        tag: 'dest-tag',
                        runnerProofHash: hashRunnerProof(proof),
                    }
                }
                if (id === 'old-machine') {
                    return {
                        namespace: 'default',
                        tag: 'other-tag',
                        runnerProofHash: null,
                    }
                }
                return null
            },
            migrateSessionsMachineId: () => {
                throw new Error('should not migrate')
            },
        } as never)

        const response = await app.request('/cli/machines/new-machine/migrate-sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                fromMachineId: 'old-machine',
                machineTag: 'dest-tag',
                runnerProof: proof,
                sourceRunnerProof: 'any-source-proof',
            }),
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Source machine continuity not proven' })
    })

    it('migrates when destination and source proofs both verify (#1473)', async () => {
        const { hashRunnerProof } = await import('../../utils/runnerProof')
        const destProof = 'runner-proof-ok'
        const sourceProof = 'old-proof'
        const tag = 'shared-tag'
        const migratedCalls: Array<[string, string, string]> = []
        const app = createApp({
            getMachineAuthMaterial: (id: string) => {
                if (id === 'new-machine') {
                    return {
                        namespace: 'default',
                        tag,
                        runnerProofHash: hashRunnerProof(destProof),
                    }
                }
                if (id === 'old-machine') {
                    return {
                        namespace: 'default',
                        tag,
                        runnerProofHash: hashRunnerProof(sourceProof),
                    }
                }
                return null
            },
            migrateSessionsMachineId: (from: string, to: string, ns: string) => {
                migratedCalls.push([from, to, ns])
                return 1
            },
        } as never)

        const response = await app.request('/cli/machines/new-machine/migrate-sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                fromMachineId: 'old-machine',
                machineTag: tag,
                runnerProof: destProof,
                sourceRunnerProof: sourceProof,
            }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ migrated: 1 })
        expect(migratedCalls).toEqual([['old-machine', 'new-machine', 'default']])
    })

    it('rejects migrate when destination uses a copied source tag without source proof (#1473)', async () => {
        const { hashRunnerProof } = await import('../../utils/runnerProof')
        const destProof = 'forged-dest-proof'
        const tag = 'stolen-tag'
        const app = createApp({
            getMachineAuthMaterial: (id: string) => {
                if (id === 'new-machine') {
                    return {
                        namespace: 'default',
                        tag,
                        runnerProofHash: hashRunnerProof(destProof),
                    }
                }
                if (id === 'old-machine') {
                    return {
                        namespace: 'default',
                        tag,
                        runnerProofHash: hashRunnerProof('victim-proof'),
                    }
                }
                return null
            },
            migrateSessionsMachineId: () => {
                throw new Error('should not migrate without source proof')
            },
        } as never)

        const missingSource = await app.request('/cli/machines/new-machine/migrate-sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                fromMachineId: 'old-machine',
                machineTag: tag,
                runnerProof: destProof,
            }),
        })
        expect(missingSource.status).toBe(400)

        const wrongSource = await app.request('/cli/machines/new-machine/migrate-sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                fromMachineId: 'old-machine',
                machineTag: tag,
                runnerProof: destProof,
                sourceRunnerProof: 'wrong-source-proof',
            }),
        })
        expect(wrongSource.status).toBe(403)
        expect(await wrongSource.json()).toEqual({ error: 'Source machine proof mismatch' })
    })
})
