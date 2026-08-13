import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { ProvenanceDiagnostics } from '@hapi/protocol/provenanceDiagnostics'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createDoctorRoutes } from './doctor'

function createApp(getProvenanceDiagnostics: SyncEngine['getProvenanceDiagnostics']) {
    const engine = {
        getProvenanceDiagnostics,
    } as unknown as SyncEngine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createDoctorRoutes(() => engine))
    return app
}

const baseDiagnostics: ProvenanceDiagnostics = {
    generatedAt: 100,
    sessions: [],
    machines: [],
    unverifiedPeerMessages: [],
    messageScan: null,
    summary: {
        activeSessions: 0,
        unprovenActiveSessions: 0,
        archivedButActiveSessions: 0,
        onlineMachines: 0,
        machinesWithIssues: 0,
        unverifiedPeerMessages: 0,
    },
}

describe('doctor routes', () => {
    it('GET /doctor/provenance returns hub diagnostics', async () => {
        const app = createApp(() => baseDiagnostics)
        const response = await app.request('/api/doctor/provenance')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(baseDiagnostics)
    })

    it('passes message scan options to sync engine', async () => {
        let captured: unknown
        const app = createApp((_namespace, options) => {
            captured = options
            return baseDiagnostics
        })
        const response = await app.request('/api/doctor/provenance?sinceDays=3&messageLimit=10&maxScan=100')
        expect(response.status).toBe(200)
        expect(captured).toEqual({
            messageScan: expect.objectContaining({
                limit: 10,
                maxScan: 100,
            }),
        })
    })

    it('skipMessages=1 disables message scan', async () => {
        let captured: unknown
        const app = createApp((_namespace, options) => {
            captured = options
            return baseDiagnostics
        })
        const response = await app.request('/api/doctor/provenance?skipMessages=1')
        expect(response.status).toBe(200)
        expect(captured).toEqual({ messageScan: false })
    })

    it('clamps message scan query params to operator-safe ceilings', async () => {
        let captured: unknown
        const app = createApp((_namespace, options) => {
            captured = options
            return baseDiagnostics
        })
        const response = await app.request(
            '/api/doctor/provenance?sinceDays=999&messageLimit=999999&maxScan=999999'
        )
        expect(response.status).toBe(200)
        expect(captured).toEqual({
            messageScan: expect.objectContaining({
                limit: 200,
                maxScan: 20_000,
            }),
        })
        const scan = (captured as { messageScan: { sinceMs: number } }).messageScan
        const sinceDays = (Date.now() - scan.sinceMs) / (24 * 60 * 60 * 1000)
        expect(sinceDays).toBeLessThanOrEqual(90.1)
        expect(sinceDays).toBeGreaterThan(89)
    })
})
