import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { ProvenanceDiagnostics } from '@hapi/protocol/provenanceDiagnostics'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createDoctorRoutes } from './doctor'

function createApp(diagnostics: ProvenanceDiagnostics) {
    const engine = {
        getProvenanceDiagnostics: () => diagnostics,
    } as unknown as SyncEngine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createDoctorRoutes(() => engine))
    return app
}

describe('doctor routes', () => {
    it('GET /doctor/provenance returns hub diagnostics', async () => {
        const diagnostics: ProvenanceDiagnostics = {
            generatedAt: 100,
            sessions: [],
            machines: [],
            summary: {
                activeSessions: 0,
                unprovenActiveSessions: 0,
                archivedButActiveSessions: 0,
                onlineMachines: 0,
                machinesWithIssues: 0,
            },
        }
        const app = createApp(diagnostics)
        const response = await app.request('/api/doctor/provenance')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(diagnostics)
    })
})
