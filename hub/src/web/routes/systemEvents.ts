import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSession, requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeId: z.coerce.number().int().positive().optional(),
    sessionId: z.string().min(1).optional(),
    attentionCandidate: z.enum(['0', '1']).optional(),
    eventType: z.string().min(1).optional(),
    sourceKind: z.string().min(1).optional()
})

const flag01 = z.literal([0, 1])

const artifactRefSchema = z.object({
    kind: z.enum(['github_pr', 'github_issue', 'github_notification']),
    url: z.string().min(1),
    title: z.string().optional(),
    repo: z.string().min(1),
    number: z.number().int().positive().optional(),
    target_id: z.string().min(1).optional(),
    control: z.enum(['ours', 'theirs']).optional(),
    github_state: z.enum(['open', 'merged', 'closed', 'draft']).optional(),
    source: z.literal('external')
})

const postBodySchema = z.object({
    ts: z.number().int().positive().optional(),
    sourceKind: z.literal('channel'),
    sourceRef: z.string().min(1),
    eventType: z.string().min(1),
    attentionCandidate: flag01,
    operatorActionRequired: flag01.optional(),
    riskDetected: flag01.optional(),
    summary: z.string().min(1).max(280),
    relatedSessionId: z.string().min(1).nullable().optional(),
    artifactRefs: z.array(artifactRefSchema).default([]),
    payload: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    dedupeKey: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    provenance: z.string().min(1),
    severity: z.literal([1, 2, 3, 4, 5]).optional(),
    expiresAt: z.number().int().positive().nullable().optional()
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
            eventType: parsed.data.eventType ?? null,
            sourceKind: parsed.data.sourceKind ?? null
        })

        return c.json({
            total: engine.getSystemEventCount(),
            events
        })
    })

    app.post('/system-events', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }

        // Channel-only contract: non-channel sourceKind (e.g. worker) → 400.
        if (
            body !== null
            && typeof body === 'object'
            && 'sourceKind' in body
            && (body as { sourceKind?: unknown }).sourceKind !== 'channel'
        ) {
            return c.json({ error: 'sourceKind must be channel' }, 400)
        }

        const parsed = postBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const data = parsed.data
        if (data.relatedSessionId) {
            const sessionResult = requireSession(c, engine, data.relatedSessionId)
            if (sessionResult instanceof Response) {
                return sessionResult
            }
        }

        const result = engine.insertChannelSystemEvent({
            ts: data.ts ?? Date.now(),
            sourceKind: 'channel',
            sourceRef: data.sourceRef,
            eventType: data.eventType,
            attentionCandidate: data.attentionCandidate,
            operatorActionRequired: data.operatorActionRequired ?? 0,
            riskDetected: data.riskDetected ?? 0,
            summary: data.summary,
            relatedSessionId: data.relatedSessionId ?? null,
            artifactRefs: data.artifactRefs.length > 0 ? JSON.stringify(data.artifactRefs) : null,
            payloadJson: data.payload ? JSON.stringify(data.payload) : null,
            tags: data.tags ? JSON.stringify(data.tags) : null,
            dedupeKey: data.dedupeKey ?? null,
            idempotencyKey: data.idempotencyKey,
            provenance: data.provenance,
            severity: data.severity ?? null,
            expiresAt: data.expiresAt ?? null
        })

        if (!result) {
            return c.json({ error: 'Failed to insert system event' }, 500)
        }

        if (result.deduped) {
            return c.json({ event: result.event, deduped: true }, 200)
        }
        return c.json({ event: result.event, deduped: false }, 201)
    })

    return app
}
