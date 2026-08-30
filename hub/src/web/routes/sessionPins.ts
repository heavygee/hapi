import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const pinBodySchema = z.object({
    messageId: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    targetMessageId: z.string().min(1).max(300).optional()
})

export function createSessionPinsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/sessions/:id/pins', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: false })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const parsed = pinBodySchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const event = engine.pinSessionMessage(sessionResult.session.id, {
            messageId: parsed.data.messageId,
            summary: parsed.data.summary,
            targetMessageId: parsed.data.targetMessageId ?? null
        })
        if (!event) {
            return c.json({ error: 'Failed to pin message' }, 500)
        }
        return c.json({ event }, 201)
    })

    app.delete('/sessions/:id/pins/:messageId', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: false })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const messageId = c.req.param('messageId')
        if (!messageId) {
            return c.json({ error: 'messageId required' }, 400)
        }

        const removed = engine.unpinSessionMessage(sessionResult.session.id, decodeURIComponent(messageId))
        if (!removed) {
            return c.json({ error: 'Pin not found' }, 404)
        }
        return c.json({ ok: true })
    })

    return app
}
