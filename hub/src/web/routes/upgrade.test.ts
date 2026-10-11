import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createUpgradeRoutes } from './upgrade'
import {
    initFleetUpgradePolicy,
    resetFleetUpgradePolicyForTests,
} from '../../upgrade/fleetUpgradePolicy'

const tmpDirs: string[] = []

function makeApp(namespace = 'default') {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        c.set('userId', 1)
        await next()
    })
    app.route('/api', createUpgradeRoutes(() => null))
    return app
}

afterEach(() => {
    resetFleetUpgradePolicyForTests()
    for (const dir of tmpDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('upgrade routes', () => {
    it('GET /upgrade/offer includes the current policy', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-'))
        tmpDirs.push(dir)
        initFleetUpgradePolicy({ dataDir: dir, persisted: 'alert' })

        const res = await makeApp().request('/api/upgrade/offer')
        expect(res.status).toBe(200)
        const body = await res.json() as { offer: { targetVersion: string }; policy: string }
        expect(body.policy).toBe('alert')
        expect(typeof body.offer.targetVersion).toBe('string')
    })

    it('PUT /upgrade/policy updates a valid policy in the default namespace', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-'))
        tmpDirs.push(dir)
        initFleetUpgradePolicy({ dataDir: dir, persisted: 'auto' })

        const res = await makeApp('default').request('/api/upgrade/policy', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ policy: 'silent' }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ policy: 'silent' })

        const after = await makeApp().request('/api/upgrade/offer')
        expect((await after.json() as { policy: string }).policy).toBe('silent')
    })

    it('PUT /upgrade/policy rejects non-default namespaces', async () => {
        const res = await makeApp('tenant-a').request('/api/upgrade/policy', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ policy: 'silent' }),
        })
        expect(res.status).toBe(403)
    })

    it('PUT /upgrade/policy rejects an invalid policy', async () => {
        const res = await makeApp().request('/api/upgrade/policy', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ policy: 'turbo' }),
        })
        expect(res.status).toBe(400)
    })

    it('PUT /upgrade/machine-policies/:id sets per-machine auto without changing hub default', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-'))
        tmpDirs.push(dir)
        initFleetUpgradePolicy({ dataDir: dir, persisted: 'alert' })

        const res = await makeApp('default').request('/api/upgrade/machine-policies/ninja', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ policy: 'auto' }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {
            machineId: string
            policy: string
            effective: string
            machines: Record<string, string>
        }
        expect(body.machineId).toBe('ninja')
        expect(body.policy).toBe('auto')
        expect(body.effective).toBe('auto')
        expect(body.machines.ninja).toBe('auto')

        const offer = await makeApp().request('/api/upgrade/offer')
        expect((await offer.json() as { policy: string }).policy).toBe('alert')

        const list = await makeApp().request('/api/upgrade/machine-policies')
        expect(list.status).toBe(200)
        const listed = await list.json() as {
            hubPolicy: string
            machines: Record<string, string>
        }
        expect(listed.hubPolicy).toBe('alert')
        expect(listed.machines.ninja).toBe('auto')
    })

    it('POST /fleet/push-upgrade returns 503 when sync engine is unavailable', async () => {
        const res = await makeApp('default').request('/api/fleet/push-upgrade', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ machineIds: ['ninja'] }),
        })
        expect(res.status).toBe(503)
    })

    it('POST /fleet/push-upgrade rejects non-default namespaces', async () => {
        const res = await makeApp('tenant-a').request('/api/fleet/push-upgrade', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ machineIds: ['ninja'] }),
        })
        expect(res.status).toBe(403)
    })
})
