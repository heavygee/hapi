import { Hono } from 'hono'
import { z } from 'zod'
import {
    OVERSEER_TOOL_NAMES,
    buildOverseerIdentity,
    buildOverseerSystemPrompt,
    type OverseerConverseMessage
} from '@hapi/protocol'
import { listConfiguredVoiceBackends, resolveHubVoiceBackend } from '@hapi/protocol/voice'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import { isOverseerToolName, OverseerWriteNotAllowedError, runOverseerTool } from '../../overseer/runOverseerTool'
import { runOverseerConverse } from '../../overseer/converse'
import { assembleOverseerConverseMessages, listRecentConvoTurns, persistOverseerConvoExchange } from '../../overseer/converseContext'
import { BrainUnavailableError, filterChatModels, isKnownBrainProfile, listBrainModels, listBrainProfiles, resolveBrainConfig, resolveBrainSelection } from '../../overseer/brainClient'
import type { ActiveBrainSetting } from '../../store/settingsStore'
import { applyFocusFromClientSession } from '@hapi/protocol'

const convoTurnBodySchema = z.object({
    operatorText: z.string().max(8000).default(''),
    overseerText: z.string().max(20000).default(''),
    relatedSessionId: z.string().min(1).optional(),
    relatedEventId: z.number().int().positive().optional(),
    toolCalls: z.array(z.object({
        tool: z.enum(OVERSEER_TOOL_NAMES),
        argsSummary: z.string().max(500).optional()
    })).max(50).optional(),
    ts: z.number().int().positive().optional()
})

const converseBodySchema = z.object({
    /**
     * Transport may send full local history or just the latest operator line.
     * Hub hydrates prior `convo_turn`s and keeps only the last operator utterance
     * from this array (hub-owned memory — transports do not fork the thread).
     */
    messages: z.array(z.object({
        role: z.enum(['operator', 'overseer']),
        content: z.string().max(8000)
    })).min(1).max(40),
    relatedSessionId: z.string().min(1).optional(),
    model: z.string().max(100).optional(),
    profile: z.string().max(64).optional(),
    /** Explicit opt-in for write tools; otherwise server detects intent from the latest operator line. */
    allowWrites: z.boolean().optional()
})

const activeBrainBodySchema = z.object({
    profile: z.string().min(1).max(64),
    model: z.string().max(100).nullish()
})

/** Drop a persisted active brain when its profile was removed from env after restart. */
function getSanitizedActiveBrain(engine: SyncEngine, namespace = 'default'): ActiveBrainSetting | null {
    const settings = engine.getSettings()
    const active = settings.getActiveBrain(namespace)
    if (!active) return null
    if (isKnownBrainProfile(active.profile)) return active
    settings.clearActiveBrain(namespace)
    return null
}

export function createOverseerRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/overseer/identity', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json({
            identity: buildOverseerIdentity(),
            systemPrompt: buildOverseerSystemPrompt()
        })
    })

    // Voice surface descriptor — everything a client needs to open a voice
    // conversation with the Overseer (distinct from per-session voice). The
    // chrome-level relocation of the voice button is Step 5, not here.
    app.get('/overseer/voice', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json({
            identity: buildOverseerIdentity(),
            systemPrompt: buildOverseerSystemPrompt(),
            backend: resolveHubVoiceBackend(process.env),
            backends: listConfiguredVoiceBackends(process.env)
        })
    })

    // Configured brain profiles for the console UI (id/label/model only — no url
    // or api key is exposed to the client) plus the persisted active selection.
    app.get('/overseer/brains', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json({
            profiles: listBrainProfiles(process.env),
            active: getSanitizedActiveBrain(engine, c.get('namespace'))
        })
    })

    // The persisted active brain — the profile/model the converse + voice surfaces
    // default to when a request does not override. Switchable at whim, survives a
    // restart, no env edit / hub bounce required.
    app.get('/overseer/brain/active', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const active = getSanitizedActiveBrain(engine, c.get('namespace'))
        const selection = resolveBrainSelection(active)
        const config = resolveBrainConfig(process.env, selection)
        return c.json({
            active,
            effective: config ? { profile: selection.profile ?? 'default', model: config.model } : null
        })
    })

    app.put('/overseer/brain/active', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }
        const parsed = activeBrainBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        // Only allow selecting a profile the hub actually has configured, so the
        // console can never persist a dead brain that would silently fall back to env.
        const known = listBrainProfiles(process.env).some((p) => p.id === parsed.data.profile)
        if (!known) {
            return c.json({ error: `Unknown brain profile: ${parsed.data.profile}` }, 400)
        }

        const active = { profile: parsed.data.profile, model: parsed.data.model ?? null }
        engine.getSettings().setActiveBrain(active, c.get('namespace'))
        return c.json({ active })
    })

    // Live model list for a brain profile (proxies the endpoint's GET /models so
    // the api key stays server-side). Powers the model dropdown in the debug UI.
    app.get('/overseer/brains/:id/models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const config = resolveBrainConfig(process.env, { profile: id })
        if (!config) {
            return c.json({ profile: id, defaultModel: null, models: [], error: 'profile not configured' }, 404)
        }
        try {
            const models = filterChatModels(await listBrainModels(config))
            return c.json({ profile: id, defaultModel: config.model, models })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'failed to list models'
            const reachable = error instanceof BrainUnavailableError ? error.reachable : false
            return c.json({ profile: id, defaultModel: config.model, models: [], error: message, reachable })
        }
    })

    // Read-only tool dispatch. Writes (record_disposition) are gated off here and
    // return 403; the conversational path is the operator-directed write surface.
    app.post('/overseer/tools/:tool', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const tool = c.req.param('tool')
        if (!isOverseerToolName(tool)) {
            return c.json({ error: `Unknown overseer tool: ${tool}` }, 404)
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            body = {}
        }

        try {
            const result = await runOverseerTool(engine.getOverseer(c.get('namespace')), tool, body ?? {})
            return c.json({ tool, result })
        } catch (error) {
            if (error instanceof z.ZodError) {
                return c.json({ error: 'Invalid tool arguments', issues: error.flatten() }, 400)
            }
            if (error instanceof OverseerWriteNotAllowedError) {
                return c.json({ error: error.message }, 403)
            }
            throw error
        }
    })

    // Recent convo_turns for transport hydrate (talk-to reload, voice attach).
    // Durable memory lives in events — this is a thin read, not a chat DB.
    app.get('/overseer/converse/recent', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const rawLimit = Number(c.req.query('limit') ?? '20')
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20
        const { turns } = listRecentConvoTurns(engine.getOverseer(c.get('namespace')), { limit })
        return c.json({ turns })
    })

    // Converse — the modality-agnostic conversation core. Runs the brain LLM
    // with the read-only tools and returns a human-facing reply + tool trace.
    // Text is the first transport (debug settings); voice/XR reuse this. When
    // the brain is offline, returns brainOnline:false with a
    // friendly message rather than an error.
    //
    // Continuity: hub assembles prior `convo_turn`s (budgeted) + latest operator
    // line. Transports do not own the thread.
    app.post('/overseer/converse', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }

        const parsed = converseBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        const clientMessages = parsed.data.messages as OverseerConverseMessage[]
        if (clientMessages[clientMessages.length - 1]?.role !== 'operator') {
            return c.json({ error: 'Last message must be from the operator' }, 400)
        }

        const overseer = engine.getOverseer(c.get('namespace'))
        const namespace = c.get('namespace')
        const settings = engine.getSettings()
        const assembled = assembleOverseerConverseMessages({
            overseer,
            clientMessages
        })
        const messages = assembled.messages
        const lastOperator = [...messages].reverse().find((m) => m.role === 'operator')?.content ?? ''
        const durableFocus = settings.getConverseFocus(namespace)
        const priorFocus = applyFocusFromClientSession(
            durableFocus,
            parsed.data.relatedSessionId,
            Math.max(Date.now(), (durableFocus?.updatedAt ?? 0) + 1)
        )

        const active = getSanitizedActiveBrain(engine, c.get('namespace'))
        const config = resolveBrainConfig(process.env, resolveBrainSelection(active, {
            profile: parsed.data.profile,
            model: parsed.data.model
        }))
        if (!config) {
            // Soft 200 for clients — journal still needs a greppable line (access log is 200).
            console.warn('[Overseer][Converse] brain unavailable', {
                reason: 'not_configured',
                kind: 'not_configured',
                reachable: false,
                model: null,
                profile: parsed.data.profile ?? null
            })
            const reply = 'The Overseer brain is not configured on this hub (set OVERSEER_BRAIN_URL). I can still show raw events and inbox items, but I cannot answer in conversation yet.'
            if (priorFocus) settings.setConverseFocusIfNewer(priorFocus, namespace)
            persistOverseerConvoExchange(overseer, assembled, {
                operatorText: lastOperator,
                overseerText: reply,
                relatedSessionId: parsed.data.relatedSessionId ?? priorFocus?.sessionId ?? null
            })
            return c.json({
                reply,
                toolTrace: [],
                model: null,
                brainOnline: false,
                hydratedTurns: assembled.hydratedTurns,
                truncated: assembled.truncated,
                focus: priorFocus
            })
        }

        try {
            const { reply, toolTrace, focus } = await runOverseerConverse({
                overseer,
                config,
                messages,
                allowWrites: parsed.data.allowWrites,
                focus: priorFocus
            })

            if (focus) {
                settings.setConverseFocusIfNewer(focus, namespace)
            }
            // Do not clear durable focus on an empty result — a concurrent newer
            // turn may have already advanced it (lost-update race).

            persistOverseerConvoExchange(overseer, assembled, {
                operatorText: lastOperator,
                overseerText: reply,
                relatedSessionId:
                    parsed.data.relatedSessionId ?? focus?.sessionId ?? null,
                toolCalls: toolTrace
                    .filter((t) => t.ok)
                    .map((t) => ({ tool: t.tool, argsSummary: JSON.stringify(t.args).slice(0, 500) }))
            })

            return c.json({
                reply,
                toolTrace,
                model: config.model,
                brainOnline: true,
                hydratedTurns: assembled.hydratedTurns,
                truncated: assembled.truncated,
                focus
            })
        } catch (error) {
            if (error instanceof BrainUnavailableError) {
                // Reachable-but-failed (http 4xx/5xx, malformed body) is a converse
                // bug, not an offline brain — do not mislabel it as GPU/VR downtime.
                // Soft 200 for clients — structured warn so journalctl can find it.
                console.warn('[Overseer][Converse] brain unavailable', {
                    reason: error.reachable ? 'request_error' : 'unreachable',
                    kind: error.kind,
                    reachable: error.reachable,
                    status: error.status ?? null,
                    model: config.model,
                    profile: parsed.data.profile ?? null,
                    message: error.message.slice(0, 200)
                })
                const reply = error.reachable
                    ? 'I reached the Overseer brain but could not complete the tool conversation (request error). This is a converse-loop issue, not the brain being offline — please retry, and flag it if it persists.'
                    : 'The Overseer brain is offline right now. Try again shortly — your events and inbox are still being captured.'
                const focusToPersist = error.converseFocus ?? priorFocus
                if (focusToPersist) settings.setConverseFocusIfNewer(focusToPersist, namespace)
                persistOverseerConvoExchange(overseer, assembled, {
                    operatorText: lastOperator,
                    overseerText: reply,
                    relatedSessionId:
                        parsed.data.relatedSessionId ?? focusToPersist?.sessionId ?? null
                })
                return c.json({
                    reply,
                    toolTrace: [],
                    model: config.model,
                    brainOnline: error.reachable,
                    hydratedTurns: assembled.hydratedTurns,
                    truncated: assembled.truncated,
                    focus: focusToPersist
                })
            }
            throw error
        }
    })

    // convo_turn writeback — persists an operator<->Overseer exchange as a
    // memory-bearing event (attention_candidate=0, never an inbox item).
    app.post('/overseer/convo-turns', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }

        const parsed = convoTurnBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        if (!parsed.data.operatorText.trim() && !parsed.data.overseerText.trim()) {
            return c.json({ error: 'operatorText or overseerText is required' }, 400)
        }

        const event = engine.getOverseer(c.get('namespace')).recordConvoTurn({
            operatorText: parsed.data.operatorText,
            overseerText: parsed.data.overseerText,
            relatedSessionId: parsed.data.relatedSessionId ?? null,
            relatedEventId: parsed.data.relatedEventId ?? null,
            toolCalls: parsed.data.toolCalls,
            ts: parsed.data.ts
        })

        if (!event) {
            return c.json({ error: 'Failed to record convo turn' }, 500)
        }
        return c.json({ event })
    })

    return app
}
