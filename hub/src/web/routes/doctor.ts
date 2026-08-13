import { Hono } from 'hono'
import {
    DEFAULT_PROVENANCE_MESSAGE_LIMIT,
    DEFAULT_PROVENANCE_MESSAGE_MAX_SCAN,
    DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS,
    type ProvenanceMessageScanOptions,
} from '@hapi/protocol/provenanceMessageAudit'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseMessageScanOptions(c: {
    req: { query: (name: string) => string | undefined }
}): ProvenanceMessageScanOptions | false {
    const skip = c.req.query('skipMessages')?.trim().toLowerCase()
    if (skip === '1' || skip === 'true' || skip === 'yes') {
        return false
    }
    const sinceDays = parsePositiveInt(c.req.query('sinceDays'), DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS)
    const limit = parsePositiveInt(c.req.query('messageLimit'), DEFAULT_PROVENANCE_MESSAGE_LIMIT)
    const maxScan = parsePositiveInt(c.req.query('maxScan'), DEFAULT_PROVENANCE_MESSAGE_MAX_SCAN)
    const now = Date.now()
    return {
        sinceMs: now - sinceDays * 24 * 60 * 60 * 1000,
        limit,
        maxScan,
    }
}

export function createDoctorRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/doctor/provenance', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const messageScan = parseMessageScanOptions(c)
        return c.json(engine.getProvenanceDiagnostics(namespace, { messageScan }))
    })

    return app
}
