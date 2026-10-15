import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
const previousSoupRoot = process.env.HAPI_SOUP_ARTIFACTS_ROOT

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

/** Tip with distinct linux vs windows digests — kill-criterion for #284. */
function writeDualPlatformTip(root: string): { tag: string; linuxSha: string; winSha: string } {
    const tag = 'hapi-soup-v2026.10.15-platform284'
    const tipDir = join(root, tag)
    const linuxBytes = 'linux-x64-baseline-bytes-for-284'
    const winBytes = 'windows-x64-bytes-for-284-a0025e8d'
    const linuxSha = createHash('sha256').update(linuxBytes).digest('hex')
    const winSha = createHash('sha256').update(winBytes).digest('hex')
    mkdirSync(join(tipDir, 'linux-x64-baseline'), { recursive: true })
    mkdirSync(join(tipDir, 'windows-x64'), { recursive: true })
    writeFileSync(join(tipDir, 'linux-x64-baseline', 'hapi'), linuxBytes)
    writeFileSync(join(tipDir, 'windows-x64', 'hapi.exe'), winBytes)
    writeFileSync(join(tipDir, 'manifest.json'), `${JSON.stringify({
        schema: 1,
        tag,
        composedTipSha: 'deadbeefplatform284',
        binaries: [
            {
                target: 'bun-linux-x64-baseline',
                platform: 'linux',
                arch: 'x64',
                variant: 'baseline',
                path: 'linux-x64-baseline/hapi',
                sha256: linuxSha,
                sizeBytes: Buffer.byteLength(linuxBytes),
            },
            {
                target: 'bun-windows-x64',
                platform: 'windows',
                arch: 'x64',
                path: 'windows-x64/hapi.exe',
                sha256: winSha,
                sizeBytes: Buffer.byteLength(winBytes),
            },
        ],
    }, null, 2)}\n`)
    symlinkSync(tag, join(root, 'latest'))
    return { tag, linuxSha, winSha }
}

afterEach(() => {
    resetFleetUpgradePolicyForTests()
    if (previousSoupRoot === undefined) {
        delete process.env.HAPI_SOUP_ARTIFACTS_ROOT
    } else {
        process.env.HAPI_SOUP_ARTIFACTS_ROOT = previousSoupRoot
    }
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

    it('GET /upgrade/offer?platform=win32 returns windows tip sha, not hub linux (#284)', async () => {
        const soupRoot = mkdtempSync(join(tmpdir(), 'hapi-soup-284-'))
        const policyDir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-284-'))
        tmpDirs.push(soupRoot, policyDir)
        process.env.HAPI_SOUP_ARTIFACTS_ROOT = soupRoot
        const { tag, linuxSha, winSha } = writeDualPlatformTip(soupRoot)
        expect(linuxSha).not.toBe(winSha)
        initFleetUpgradePolicy({ dataDir: policyDir, persisted: 'alert' })

        const linuxRes = await makeApp().request('/api/upgrade/offer?platform=linux&arch=x64')
        expect(linuxRes.status).toBe(200)
        const linuxBody = await linuxRes.json() as {
            offer: {
                targetVersion: string
                artifact?: { platform: string; arch: string; sha256: string }
            }
            availablePlatforms?: Array<{ platform: string; arch: string }>
        }
        expect(linuxBody.offer.targetVersion).toBe(tag)
        expect(linuxBody.offer.artifact?.platform).toBe('linux')
        expect(linuxBody.offer.artifact?.sha256).toBe(linuxSha)

        const winRes = await makeApp().request('/api/upgrade/offer?platform=win32&arch=x64')
        expect(winRes.status).toBe(200)
        const winBody = await winRes.json() as {
            offer: {
                targetVersion: string
                artifact?: { platform: string; arch: string; sha256: string }
            }
            availablePlatforms?: Array<{ platform: string; arch: string }>
        }
        expect(winBody.offer.targetVersion).toBe(tag)
        expect(winBody.offer.artifact?.platform).toBe('win32')
        expect(winBody.offer.artifact?.arch).toBe('x64')
        expect(winBody.offer.artifact?.sha256).toBe(winSha)
        expect(winBody.offer.artifact?.sha256).not.toBe(linuxSha)

        // Alias: platform=windows must normalize to win32 Node token
        const aliasRes = await makeApp().request('/api/upgrade/offer?platform=windows&arch=x64')
        const aliasBody = await aliasRes.json() as {
            offer: { artifact?: { platform: string; sha256: string } }
        }
        expect(aliasBody.offer.artifact?.platform).toBe('win32')
        expect(aliasBody.offer.artifact?.sha256).toBe(winSha)

        const platforms = winBody.availablePlatforms ?? []
        expect(platforms.some((p) => p.platform === 'linux' && p.arch === 'x64')).toBe(true)
        expect(platforms.some((p) => p.platform === 'win32' && p.arch === 'x64')).toBe(true)
    })

    it('GET /upgrade/offer with X-Hapi-Platform header selects win32 artifact', async () => {
        const soupRoot = mkdtempSync(join(tmpdir(), 'hapi-soup-284h-'))
        const policyDir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-284h-'))
        tmpDirs.push(soupRoot, policyDir)
        process.env.HAPI_SOUP_ARTIFACTS_ROOT = soupRoot
        const { winSha } = writeDualPlatformTip(soupRoot)
        initFleetUpgradePolicy({ dataDir: policyDir, persisted: 'alert' })

        const res = await makeApp().request('/api/upgrade/offer', {
            headers: {
                'X-Hapi-Platform': 'win32',
                'X-Hapi-Arch': 'x64',
            },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {
            offer: { artifact?: { platform: string; sha256: string } }
        }
        expect(body.offer.artifact?.platform).toBe('win32')
        expect(body.offer.artifact?.sha256).toBe(winSha)
    })

    it('fail-closed: win32 query never returns linux artifact when tip has windows (#284)', async () => {
        const soupRoot = mkdtempSync(join(tmpdir(), 'hapi-soup-284fc-'))
        const policyDir = mkdtempSync(join(tmpdir(), 'hapi-upgrade-284fc-'))
        tmpDirs.push(soupRoot, policyDir)
        process.env.HAPI_SOUP_ARTIFACTS_ROOT = soupRoot
        const { linuxSha } = writeDualPlatformTip(soupRoot)
        initFleetUpgradePolicy({ dataDir: policyDir, persisted: 'alert' })

        const res = await makeApp().request('/api/upgrade/offer?platform=win32&arch=x64')
        const body = await res.json() as {
            offer: { artifact?: { platform: string; sha256: string } }
        }
        // Kill-criterion: hub-OS-only regression would return linux sha here.
        expect(body.offer.artifact?.platform).not.toBe('linux')
        expect(body.offer.artifact?.sha256).not.toBe(linuxSha)
    })
})
