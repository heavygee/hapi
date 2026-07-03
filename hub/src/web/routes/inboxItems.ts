import { Hono } from 'hono'
import { z } from 'zod'
import { INBOX_OPERATOR_ACTIONS } from '@hapi/protocol'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    activeOnly: z.enum(['0', '1']).optional(),
    sessionId: z.string().min(1).optional()
})

const actionBodySchema = z.object({
    action: z.enum(INBOX_OPERATOR_ACTIONS),
    feedback: z.string().max(500).optional(),
    snoozedUntil: z.number().int().positive().optional()
})

export function createInboxItemsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/inbox-items', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = listQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query', issues: parsed.error.flatten() }, 400)
        }

        const activeOnly = parsed.data.activeOnly === '1'
        const items = engine.getInboxItems({
            limit: parsed.data.limit ?? 50,
            activeOnly,
            sessionId: parsed.data.sessionId ?? null
        })

        return c.json({
            total: engine.getInboxItemCount(),
            items
        })
    })

    app.post('/inbox-items/:id/actions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const inboxItemId = Number(c.req.param('id'))
        if (!Number.isInteger(inboxItemId) || inboxItemId <= 0) {
            return c.json({ error: 'Invalid inbox item id' }, 400)
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }

        const parsed = actionBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const item = engine.recordInboxOperatorAction(
            inboxItemId,
            parsed.data.action,
            parsed.data.feedback ?? null,
            parsed.data.snoozedUntil ?? null
        )
        if (!item) {
            return c.json({ error: 'Inbox item not found' }, 404)
        }

        return c.json({ item })
    })

    return app
}
