import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createUpgradeRoutes } from './upgrade'
import type { HubUpgradeOffer } from '@hapi/protocol/upgradeChannel'
import type { SyncEngine } from '../../sync/syncEngine'
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

    it('GET /upgrade/offer passes platform and arch query to SyncEngine', async () => {
        const linuxOffer: HubUpgradeOffer = {
            channel: 'hub-artifact',
            targetVersion: 'hapi-soup-v1',
            targetCapabilities: [],
            artifact: { url: '/a', sha256: 'linuxsha', platform: 'linux', arch: 'x64' },
        }
        const winOffer: HubUpgradeOffer = {
            channel: 'hub-artifact',
            targetVersion: 'hapi-soup-v1',
            targetCapabilities: [],
            artifact: { url: '/b', sha256: 'winsha', platform: 'win32', arch: 'x64' },
        }
        const calls: Array<{ platform?: string; arch?: string }> = []
        const engine = {
            getHubUpgradeOffer(platform?: string, arch?: string) {
                calls.push({ platform, arch })
                if (platform === 'win32' || platform === 'windows') {
                    return winOffer
                }
                return linuxOffer
            },
        } as Pick<SyncEngine, 'getHubUpgradeOffer'>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('userId', 1)
            await next()
        })
        app.route('/api', createUpgradeRoutes(() => engine as SyncEngine))

        const linuxRes = await app.request('/api/upgrade/offer')
        const linuxBody = await linuxRes.json() as { offer: HubUpgradeOffer }
        expect(linuxBody.offer.artifact?.sha256).toBe('linuxsha')

        const winRes = await app.request('/api/upgrade/offer?platform=win32&arch=x64')
        const winBody = await winRes.json() as { offer: HubUpgradeOffer }
        expect(winBody.offer.artifact?.sha256).toBe('winsha')
        expect(calls.some((c) => c.platform === 'win32' && c.arch === 'x64')).toBe(true)
    })

})
