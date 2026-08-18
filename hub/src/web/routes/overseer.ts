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
import { BrainUnavailableError, filterChatModels, isKnownBrainProfile, listBrainModels, listBrainProfiles, resolveBrainConfig, resolveBrainSelection } from '../../overseer/brainClient'
import type { ActiveBrainSetting } from '../../store/settingsStore'

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
    messages: z.array(z.object({
        role: z.enum(['operator', 'overseer']),
        content: z.string().max(8000)
    })).min(1).max(40),
    relatedSessionId: z.string().min(1).optional(),
    model: z.string().max(100).optional(),
    profile: z.string().max(64).optional()
})

const activeBrainBodySchema = z.object({
    profile: z.string().min(1).max(64),
    model: z.string().max(100).nullish()
})

/** Drop a persisted active brain when its profile was removed from env after restart. */
function getSanitizedActiveBrain(engine: SyncEngine): ActiveBrainSetting | null {
    const settings = engine.getSettings()
    const active = settings.getActiveBrain()
    if (!active) return null
    if (isKnownBrainProfile(active.profile)) return active
    settings.clearActiveBrain()
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
            active: getSanitizedActiveBrain(engine)
        })
    })

    // The persisted active brain — the profile/model the converse + voice surfaces
    // default to when a request does not override. Switchable at whim, survives a
    // restart, no env edit / hub bounce required.
    app.get('/overseer/brain/active', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const active = getSanitizedActiveBrain(engine)
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
        if (!isKnownBrainProfile(parsed.data.profile)) {
            return c.json({ error: `Unknown brain profile: ${parsed.data.profile}` }, 400)
        }

        const active = { profile: parsed.data.profile, model: parsed.data.model ?? null }
        engine.getSettings().setActiveBrain(active)
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
            const result = runOverseerTool(engine.getOverseer(), tool, body ?? {})
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

    // Converse — the modality-agnostic conversation core. Runs the brain LLM
    // with the read-only tools and returns a human-facing reply + tool trace.
    // Text is the first transport (debug settings); voice/XR reuse this. When
    // the brain is offline (GPU pulled for VR), returns brainOnline:false with a
    // friendly message rather than an error.
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
        const messages = parsed.data.messages as OverseerConverseMessage[]
        if (messages[messages.length - 1]?.role !== 'operator') {
            return c.json({ error: 'Last message must be from the operator' }, 400)
        }

        const active = getSanitizedActiveBrain(engine)
        const config = resolveBrainConfig(process.env, resolveBrainSelection(active, {
            profile: parsed.data.profile,
            model: parsed.data.model
        }))
        if (!config) {
            return c.json({
                reply: 'The Overseer brain is not configured on this hub (set OVERSEER_BRAIN_URL). I can still show raw events and inbox items, but I cannot answer in conversation yet.',
                toolTrace: [],
                model: null,
                brainOnline: false
            })
        }

        try {
            const { reply, toolTrace } = await runOverseerConverse({
                overseer: engine.getOverseer(),
                config,
                messages
            })

            const lastOperator = [...messages].reverse().find((m) => m.role === 'operator')?.content ?? ''
            engine.getOverseer().recordConvoTurn({
                operatorText: lastOperator,
                overseerText: reply,
                relatedSessionId: parsed.data.relatedSessionId ?? null,
                toolCalls: toolTrace
                    .filter((t) => t.ok)
                    .map((t) => ({ tool: t.tool, argsSummary: JSON.stringify(t.args).slice(0, 500) }))
            })

            return c.json({ reply, toolTrace, model: config.model, brainOnline: true })
        } catch (error) {
            if (error instanceof BrainUnavailableError) {
                // Reachable-but-failed (http 4xx/5xx, malformed body) is a converse
                // bug, not an offline brain — do not mislabel it as GPU/VR downtime.
                const reply = error.reachable
                    ? 'I reached the Overseer brain but could not complete the tool conversation (request error). This is a converse-loop issue, not the brain being offline — please retry, and flag it if it persists.'
                    : 'The Overseer brain is offline right now (the GPU may be in use for VR). Try again shortly — your events and inbox are still being captured.'
                return c.json({
                    reply,
                    toolTrace: [],
                    model: config.model,
                    brainOnline: error.reachable
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

        const event = engine.getOverseer().recordConvoTurn({
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
