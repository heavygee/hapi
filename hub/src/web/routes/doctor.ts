import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

export function createDoctorRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/doctor/provenance', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        return c.json(engine.getProvenanceDiagnostics(namespace))
    })

    return app
}
