import { Hono } from 'hono'
import { z } from 'zod'
import {
    OVERSEER_TOOL_NAMES,
    buildOverseerIdentity,
    buildOverseerSystemPrompt,
    overseerToolArgsSchemas,
    type OverseerToolName
} from '@hapi/protocol'
import { listConfiguredVoiceBackends, resolveHubVoiceBackend } from '@hapi/protocol/voice'
import type { SyncEngine } from '../../sync/syncEngine'
import type { OverseerEntity } from '../../sync/overseerEntity'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

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

function runTool(overseer: OverseerEntity, tool: OverseerToolName, args: unknown): unknown {
    switch (tool) {
        case 'query_events':
            return { events: overseer.queryEvents(overseerToolArgsSchemas.query_events.parse(args)) }
        case 'query_inbox':
            return overseer.queryInbox(overseerToolArgsSchemas.query_inbox.parse(args))
        case 'get_session_state': {
            const parsed = overseerToolArgsSchemas.get_session_state.parse(args)
            return { state: overseer.getSessionState(parsed.sessionId) }
        }
        case 'get_session_recent_output': {
            const parsed = overseerToolArgsSchemas.get_session_recent_output.parse(args)
            return { chunks: overseer.getSessionRecentOutput(parsed.sessionId, parsed.n ?? 10) }
        }
        case 'get_worker_health': {
            const parsed = overseerToolArgsSchemas.get_worker_health.parse(args)
            return { health: overseer.getWorkerHealth(parsed.sessionId) }
        }
        case 'explain_priority': {
            const parsed = overseerToolArgsSchemas.explain_priority.parse(args)
            return { explanation: overseer.explainPriority(parsed.itemId) }
        }
        case 'list_active_workers':
            return { workers: overseer.listActiveWorkers(overseerToolArgsSchemas.list_active_workers.parse(args)) }
        default: {
            const exhaustive: never = tool
            throw new Error(`Unknown overseer tool: ${String(exhaustive)}`)
        }
    }
}

function isToolName(value: string): value is OverseerToolName {
    return (OVERSEER_TOOL_NAMES as readonly string[]).includes(value)
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

    // Read-only tool dispatch. All tools are read-only; this endpoint never
    // mutates worker or inbox state.
    app.post('/overseer/tools/:tool', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const tool = c.req.param('tool')
        if (!isToolName(tool)) {
            return c.json({ error: `Unknown overseer tool: ${tool}` }, 404)
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            body = {}
        }

        try {
            const result = runTool(engine.getOverseer(), tool, body ?? {})
            return c.json({ tool, result })
        } catch (error) {
            if (error instanceof z.ZodError) {
                return c.json({ error: 'Invalid tool arguments', issues: error.flatten() }, 400)
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
