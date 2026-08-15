import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import type { KitchenStatusResponse } from '@hapi/protocol/apiTypes'
import { createKitchenStatusRoutes, parseKitchenStatusOutput } from './kitchenStatus'

function createApp(namespace: string, getStatus: () => Promise<KitchenStatusResponse>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createKitchenStatusRoutes({ getStatus }))
    return app
}

describe('parseKitchenStatusOutput', () => {
    it('marks parsed script JSON as available and stamps checkedAt', () => {
        const stdout = JSON.stringify({ status: 'dirty', mirrorDirty: true, oneliner: 'kitchen: dirty' })
        const result = parseKitchenStatusOutput(stdout)
        expect(result.available).toBe(true)
        if (result.available) {
            expect(result.status).toBe('dirty')
            expect(result.mirrorDirty).toBe(true)
            expect(typeof result.checkedAt).toBe('number')
        }
    })

    it('reports unavailable on empty or malformed stdout', () => {
        expect(parseKitchenStatusOutput('')).toEqual({ available: false })
        expect(parseKitchenStatusOutput('not json')).toEqual({ available: false })
    })
})

describe('GET /api/kitchen-status', () => {
    it('returns 403 for non-owner namespaces without invoking the script', async () => {
        let called = false
        const app = createApp('shared-abc', async () => {
            called = true
            return { available: false }
        })
        const response = await app.request('/api/kitchen-status')
        expect(response.status).toBe(403)
        expect(called).toBe(false)
    })

    it('returns the status payload for the hub owner namespace', async () => {
        const app = createApp('default', async () => ({
            available: true,
            status: 'green',
            driverHead: 'abc1234',
            driverLayers: 3,
            mirror: 'clean',
            mirrorDirty: false,
            forkAhead: 0,
            forkBehind: 0,
            working: '0',
            holdActive: false,
            holdReason: '',
            lease: 'unheld',
            driverBusy: false,
            ruleChopped: false,
            oneliner: 'kitchen: green',
            checkedAt: 1
        }))
        const response = await app.request('/api/kitchen-status')
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        const body = await response.json() as KitchenStatusResponse
        expect(body.available).toBe(true)
        expect(body.available && body.oneliner).toBe('kitchen: green')
    })

    it('returns unavailable when the script is missing without erroring', async () => {
        const app = createApp('default', async () => ({ available: false }))
        const response = await app.request('/api/kitchen-status')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ available: false })
    })
})
