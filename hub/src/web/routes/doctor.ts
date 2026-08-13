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

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
    if (!value) return fallback
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.min(parsed, max)
}

const MAX_PROVENANCE_SINCE_DAYS = 90
const MAX_PROVENANCE_MESSAGE_LIMIT = 200
const MAX_PROVENANCE_MESSAGE_MAX_SCAN = 20_000

function parseMessageScanOptions(c: {
    req: { query: (name: string) => string | undefined }
}): ProvenanceMessageScanOptions | false {
    const skip = c.req.query('skipMessages')?.trim().toLowerCase()
    if (skip === '1' || skip === 'true' || skip === 'yes') {
        return false
    }
    const sinceDays = parsePositiveInt(
        c.req.query('sinceDays'),
        DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS,
        MAX_PROVENANCE_SINCE_DAYS
    )
    const limit = parsePositiveInt(
        c.req.query('messageLimit'),
        DEFAULT_PROVENANCE_MESSAGE_LIMIT,
        MAX_PROVENANCE_MESSAGE_LIMIT
    )
    const maxScan = parsePositiveInt(
        c.req.query('maxScan'),
        DEFAULT_PROVENANCE_MESSAGE_MAX_SCAN,
        MAX_PROVENANCE_MESSAGE_MAX_SCAN
    )
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
