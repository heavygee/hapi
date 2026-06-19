import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeId: z.coerce.number().int().positive().optional(),
    sessionId: z.string().min(1).optional(),
    attentionCandidate: z.enum(['0', '1']).optional(),
    eventType: z.string().min(1).optional()
})

export function createSystemEventsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/system-events', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = querySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query', issues: parsed.error.flatten() }, 400)
        }

        const attentionCandidate = parsed.data.attentionCandidate === undefined
            ? null
            : parsed.data.attentionCandidate === '1' ? 1 : 0

        const events = engine.getSystemEvents({
            limit: parsed.data.limit ?? 50,
            beforeId: parsed.data.beforeId ?? null,
            sessionId: parsed.data.sessionId ?? null,
            attentionCandidate,
            eventType: parsed.data.eventType ?? null
        })

        return c.json({
            total: engine.getSystemEventCount(),
            events
        })
    })

    return app
}
