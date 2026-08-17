import { Hono } from 'hono'
import { z } from 'zod'
import {
    CliPeerDeliverRequestSchema,
    CreateOrLoadMachineRequestSchema,
    CreateOrLoadSessionRequestSchema,
    ClearOpencodeSessionCallbackRequestSchema,
    CursorMigrateToAcpRequestSchema,
    HAPI_SESSION_CAPABILITY_HEADER,
    PROTOCOL_VERSION
} from '@hapi/protocol'
import { resolvePeerMetaFromSourceSession } from './messages'
import { mintPeerSessionCapability, verifyPeerSessionCapability } from '../peerCapability'
import { redeemResumePeerMint } from '../pendingResumePeerMint'
import { verifyRunnerProof } from '../../utils/runnerProof'
import { getConfiguration } from '../../configuration'
import { readSessionSummaryContractEnabled } from '../../config/sessionSummaryContract'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import { SessionIdentityConflictError } from '../../store/sessions'
import { MachineTagConflictError } from '../../store/machines'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
    }
}

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string
): { ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    namespace: string
): { ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string } {
    const machine = engine.getMachineByNamespace(machineId, namespace)
    if (machine) {
        return { ok: true, machine }
    }
    if (engine.getMachine(machineId)) {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
}

function clearErrorStatus(code: string): 403 | 404 | 409 | 500 {
    return code === 'access_denied' ? 403
        : code === 'session_not_found' ? 404
            : code === 'clear_unavailable' ? 409
                : 500
}

export function createCliRoutes(
    getSyncEngine: () => SyncEngine | null,
    jwtSecret: Uint8Array = new TextEncoder().encode('test-secret')
): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header('X-Hapi-Protocol-Version', String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const configuration = getConfiguration()
        const parsedToken = parseAccessToken(token)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid token' }, 401)
        }

        c.set('namespace', parsedToken.namespace)
        return await next()
    })

    app.post('/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadSessionRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const machineInput = parsed.data.machine
        if (machineInput) {
            const existingMachine = engine.getMachine(machineInput.id)
            if (existingMachine && existingMachine.namespace !== namespace) {
                return c.json({ error: 'Machine access denied' }, 403)
            }
            try {
                engine.getOrCreateMachine(
                    machineInput.id,
                    machineInput.metadata,
                    machineInput.runnerState ?? null,
                    namespace,
                    machineInput.tag,
                    machineInput.runnerProof
                )
            } catch (error) {
                if (error instanceof MachineTagConflictError) {
                    return c.json({ error: error.message }, 409)
                }
                throw error
            }
        }

        try {
            const session = engine.getOrCreateSession(
                parsed.data.tag,
                parsed.data.metadata,
                parsed.data.agentState ?? null,
                namespace,
                parsed.data.model,
                parsed.data.effort,
                parsed.data.modelReasoningEffort,
                parsed.data.id
            )
            const sessionSummaryContract = await readSessionSummaryContractEnabled(
                getConfiguration().dataDir
            )
            const sessionCapability = mintPeerSessionCapability(session.id, jwtSecret)
            return c.json({ session, sessionSummaryContract, sessionCapability })
        } catch (error) {
            if (error instanceof SessionIdentityConflictError) {
                return c.json({ error: error.message }, 409)
            }
            throw error
        }
    })

    app.get('/sessions/resumable', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const machineId = c.req.query('machineId') || undefined
        const sessions = engine.listLocalResumableSessions(namespace, { machineId })
        return c.json({ sessions })
    })

    app.get('/sessions/:id/resume-target', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const result = engine.resolveLocalResumeTarget(c.req.param('id'), namespace)
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : 409
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ target: result.target })
    })

    app.post('/sessions/:id/handoff-local', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const result = await engine.handoffSessionToLocal(c.req.param('id'), namespace)
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : result.code === 'already_local' ? 409
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ ok: true })
    })

    /**
     * Terminal `hapi resume` without inject env asks the runner to spawn with
     * a hub-minted capability (same path as web resume). Capability stays inside
     * the runner-tracked child — unrelated shells must not receive a mint (#1473).
     */
    app.post('/sessions/:id/resume', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const result = await engine.resumeSession(c.req.param('id'), namespace)
        if (result.type === 'error') {
            const status = result.code === 'no_machine_online' ? 503
                : result.code === 'access_denied' ? 403
                    : result.code === 'session_not_found' ? 404
                        : result.code === 'resume_unavailable' ? 409
                            : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.post('/sessions/:id/clear-opencode', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const result = await engine.clearOpenCodeSession(c.req.param('id'), c.get('namespace'))
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : result.code === 'clear_unavailable' ? 409
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }
        return c.json({ ok: true, sessionId: result.sessionId })
    })

    app.post('/sessions/:id/clear-opencode/reserve', (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not ready' }, 503)
        const result = engine.reserveOpenCodeClearSession(c.req.param('id'), c.get('namespace'))
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403 : result.code === 'session_not_found' ? 404 : result.code === 'clear_unavailable' ? 409 : 500
            return c.json({ error: result.message, code: result.code }, status)
        }
        return c.json({ ok: true, sessionId: result.sessionId })
    })

    app.post('/sessions/:id/clear-opencode/abort', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not ready' }, 503)
        const parsed = ClearOpencodeSessionCallbackRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid clear callback request' }, 400)
        const result = engine.abortOpenCodeClearSession(c.req.param('id'), c.get('namespace'), parsed.data.replacementSessionId)
        if (result.type === 'error') return c.json({ error: result.message, code: result.code }, clearErrorStatus(result.code))
        return c.json({ ok: true, sessionId: result.sessionId })
    })

    app.post('/sessions/:id/clear-opencode/confirm-cleanup', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not ready' }, 503)
        const parsed = ClearOpencodeSessionCallbackRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid clear callback request' }, 400)
        const result = engine.confirmOpenCodeClearCleanup(c.req.param('id'), c.get('namespace'), parsed.data.replacementSessionId)
        if (result.type === 'error') return c.json({ error: result.message, code: result.code }, clearErrorStatus(result.code))
        return c.json({ ok: true, sessionId: result.sessionId })
    })

    app.get('/sessions/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        const sessionSummaryContract = await readSessionSummaryContractEnabled(
            getConfiguration().dataDir
        )
        return c.json({ session: resolved.session, sessionSummaryContract })
    })

    app.get('/sessions/:id/messages', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        // Future-scheduled rows are excluded from CLI backfill — see
        // messages.ts:getDeliverableMessagesAfter for the rationale.  The
        // mature-scan path (releaseMatureScheduledMessages) is the sole
        // emit channel for scheduled rows.
        const messages = engine.getDeliverableMessagesAfter(resolved.sessionId, {
            afterSeq: parsed.data.afterSeq,
            limit,
            now: Date.now()
        })
        return c.json({ messages })
    })

    /**
     * Removed: file-backed reenroll grants break same-UID isolation (#1473 Blocker).
     * Hub grant helpers deleted; `machine_reenroll_*` tables remain from v25/v26
     * migrations but have no writers. Cold recovery rotates machine id then
     * migrate-sessions (no tag-only proof rebind).
     */
    app.post('/machines/:id/reenroll-grant', async (c) => {
        return c.json({
            error: 'Reenroll grants removed; rotate machine id then migrate-sessions',
        }, 410)
    })

    app.post('/machines/:id/reenroll-grant/ack', async (c) => {
        return c.json({
            error: 'Reenroll grants removed; rotate machine id then migrate-sessions',
        }, 410)
    })

    /**
     * Remap session metadata.machineId after forced machine re-enroll (#1473).
     * Destination must present live runnerProof + machineTag. Source must also
     * present its runnerProof — machineTag alone is same-UID readable from
     * settings.json, so a sibling must not absorb sessions onto a machine it
     * controls. Cold restart that lost the memory-only proof cannot use this
     * route; operator-trusted remap is required instead.
     */
    app.post('/machines/:id/migrate-sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const newMachineId = c.req.param('id')
        const namespace = c.get('namespace')
        const body = await c.req.json().catch(() => null)
        const fromMachineId = body && typeof body === 'object' && typeof (body as { fromMachineId?: unknown }).fromMachineId === 'string'
            ? (body as { fromMachineId: string }).fromMachineId.trim()
            : ''
        const machineTag = body && typeof body === 'object' && typeof (body as { machineTag?: unknown }).machineTag === 'string'
            ? (body as { machineTag: string }).machineTag.trim()
            : ''
        const runnerProof = body && typeof body === 'object' && typeof (body as { runnerProof?: unknown }).runnerProof === 'string'
            ? (body as { runnerProof: string }).runnerProof.trim()
            : ''
        const sourceRunnerProof = body && typeof body === 'object' && typeof (body as { sourceRunnerProof?: unknown }).sourceRunnerProof === 'string'
            ? (body as { sourceRunnerProof: string }).sourceRunnerProof.trim()
            : ''
        if (!fromMachineId || !machineTag || !runnerProof || !sourceRunnerProof) {
            return c.json({
                error: 'fromMachineId, machineTag, runnerProof, and sourceRunnerProof required',
            }, 400)
        }
        const authMaterial = engine.getMachineAuthMaterial(newMachineId)
        if (!authMaterial || authMaterial.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const storedTag = typeof authMaterial.tag === 'string' ? authMaterial.tag : ''
        if (!storedTag || !constantTimeEquals(storedTag, machineTag)) {
            return c.json({ error: 'Machine tag mismatch' }, 403)
        }
        if (!verifyRunnerProof(runnerProof, authMaterial.runnerProofHash)) {
            return c.json({ error: 'Machine runner proof mismatch' }, 403)
        }
        const fromAuth = engine.getMachineAuthMaterial(fromMachineId)
        if (!fromAuth || fromAuth.namespace !== namespace) {
            return c.json({ error: 'Source machine not found' }, 404)
        }
        const sourceTag = typeof fromAuth.tag === 'string' ? fromAuth.tag : ''
        // Untagged (v23) sources cannot prove continuity on this namespace endpoint —
        // any proven destination could absorb their sessions (#1473 Blocker).
        // Legacy recovery needs an operator-trusted path, not migrate-sessions.
        if (!sourceTag || !constantTimeEquals(sourceTag, machineTag)) {
            return c.json({ error: 'Source machine continuity not proven' }, 403)
        }
        if (!verifyRunnerProof(sourceRunnerProof, fromAuth.runnerProofHash)) {
            return c.json({ error: 'Source machine proof mismatch' }, 403)
        }
        try {
            const migrated = engine.migrateSessionsMachineId(fromMachineId, newMachineId, namespace)
            return c.json({ migrated })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Session migration failed'
            return c.json({ error: message }, 409)
        }
    })

    /**
     * Live runner mints a session capability for terminal `hapi resume`.
     * Requires the session's recorded machineId + live runnerProof (#1473).
     */
    app.post('/sessions/:id/local-resume-capability', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const source = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!source.ok) {
            return c.json({ error: source.error }, source.status)
        }
        const body = await c.req.json().catch(() => null)
        const machineTag = body && typeof body === 'object' && typeof (body as { machineTag?: unknown }).machineTag === 'string'
            ? (body as { machineTag: string }).machineTag.trim()
            : ''
        const runnerProof = body && typeof body === 'object' && typeof (body as { runnerProof?: unknown }).runnerProof === 'string'
            ? (body as { runnerProof: string }).runnerProof.trim()
            : ''
        if (!machineTag || !runnerProof) {
            return c.json({ error: 'machineTag and runnerProof required' }, 400)
        }
        const recordedMachineId = typeof source.session.metadata?.machineId === 'string'
            ? source.session.metadata.machineId.trim()
            : ''
        if (!recordedMachineId) {
            return c.json({ error: 'Session has no recorded machine' }, 403)
        }
        const authMaterial = engine.getMachineAuthMaterial(recordedMachineId)
        if (!authMaterial || authMaterial.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const storedTag = typeof authMaterial.tag === 'string' ? authMaterial.tag : ''
        if (!storedTag || !constantTimeEquals(storedTag, machineTag)) {
            return c.json({ error: 'Machine tag mismatch' }, 403)
        }
        if (!verifyRunnerProof(runnerProof, authMaterial.runnerProofHash)) {
            return c.json({ error: 'Machine runner proof mismatch' }, 403)
        }
        return c.json({
            sessionCapability: mintPeerSessionCapability(source.sessionId, jwtSecret),
        })
    })

    /**
     * Runner redeems a resume peer-mint nonce from the machine spawn RPC
     * (#1203 pass 2h). Not available on anonymous /cli socket connect.
     * Terminal attach without this inject path must not mint capabilities
     * from shared machineTag (sibling forgery — #1473 Blocker).
     */
    app.post('/sessions/:id/resume-peer-capability', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const source = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!source.ok) {
            return c.json({ error: source.error }, source.status)
        }
        const body = await c.req.json().catch(() => null)
        const nonce = body && typeof body === 'object' && typeof (body as { nonce?: unknown }).nonce === 'string'
            ? (body as { nonce: string }).nonce
            : undefined
        if (!redeemResumePeerMint(source.sessionId, nonce)) {
            return c.json({ error: 'Invalid or expired resume peer mint' }, 403)
        }
        return c.json({
            sessionCapability: mintPeerSessionCapability(source.sessionId, jwtSecret),
        })
    })

    /**
     * Attributed peer delivery (#1203). Source id is this path param, accepted
     * only with a matching session capability (HMAC over hub JWT secret).
     * Shared CLI token + path claim alone is rejected.
     */
    app.post('/sessions/:id/peer-messages', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sourceSessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const source = resolveSessionForNamespace(engine, sourceSessionId, namespace)
        if (!source.ok) {
            return c.json({ error: source.error }, source.status)
        }

        const capability = c.req.header(HAPI_SESSION_CAPABILITY_HEADER)
        if (!verifyPeerSessionCapability(source.sessionId, capability, jwtSecret)) {
            return c.json({ error: 'Invalid session capability' }, 403)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = CliPeerDeliverRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const target = resolveSessionForNamespace(engine, parsed.data.targetSessionId, namespace)
        if (!target.ok) {
            return c.json({ error: target.error }, target.status)
        }
        if (!target.session.active) {
            return c.json({ error: 'Session is not active' }, 409)
        }

        const peer = resolvePeerMetaFromSourceSession(engine, namespace, source.sessionId)
        await engine.sendMessage(target.sessionId, {
            text: parsed.data.text,
            localId: parsed.data.localId,
            sentFrom: 'peer',
            peer,
            deliveryMode: parsed.data.deliveryMode
        })
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/migrate-to-acp', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        // Codex #34 P2 (round 13): mirror the sessions.ts route hardening —
        // distinguish "no body" from "malformed JSON". A silent fallback to
        // {} would run the migration with destructive defaults even when
        // the operator's intended body was mangled in transit.
        const rawBody = await c.req.text()
        let body: unknown = {}
        if (rawBody.trim().length > 0) {
            try {
                body = JSON.parse(rawBody)
            } catch {
                return c.json({ error: 'Invalid JSON body' }, 400)
            }
        }
        const parsed = CursorMigrateToAcpRequestSchema.safeParse(body ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400)
        }
        const outcome = await engine.migrateLegacyCursorSession(resolved.sessionId, namespace, parsed.data)
        const status = outcome.ok ? 200
            : outcome.reason === 'already_acp' || outcome.reason === 'not_cursor_session' || outcome.reason === 'no_cursor_session_id' ? 409
                : outcome.reason === 'running_refused' ? 409
                    : outcome.reason === 'target_already_exists' ? 409
                        : outcome.reason === 'no_legacy_store_on_disk' ? 404
                            : 500
        return c.json(outcome, status)
    })

    app.post('/machines', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadMachineRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const existing = engine.getMachine(parsed.data.id)
        if (existing && existing.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        try {
            const machine = engine.getOrCreateMachine(
                parsed.data.id,
                parsed.data.metadata,
                parsed.data.runnerState ?? null,
                namespace,
                parsed.data.tag,
                parsed.data.runnerProof
            )
            return c.json({ machine })
        } catch (error) {
            if (error instanceof MachineTagConflictError) {
                return c.json({ error: error.message }, 409)
            }
            throw error
        }
    })

    app.get('/machines/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveMachineForNamespace(engine, machineId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    return app
}
