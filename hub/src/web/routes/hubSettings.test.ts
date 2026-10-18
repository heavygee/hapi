import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { STOCK_PEER_SPAWN_DEFAULTS } from '@hapi/protocol/peerSpawnDefaults'
import type { WebAppEnv } from '../middleware/auth'
import { createHubSettingsRoutes } from './hubSettings'
import { SESSION_START_TIMEOUT_MS_MAX } from '@hapi/protocol'
import { getSettingsFile, updateSettings } from '../../config/settings'
import { writeSessionSummaryContractEnabled } from '../../config/sessionSummaryContract'
import { writeSessionSummaryInChatEnabled } from '../../config/sessionSummaryInChat'

const directories: string[] = []
const stockPeerSpawnDefaults = {
    ...STOCK_PEER_SPAWN_DEFAULTS,
    permissionMode: 'bypassPermissions' as const
}

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('GET/PUT /api/hub-settings', () => {
    async function createApp(namespace = 'default') {
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-hub-settings-'))
        directories.push(dataDir)
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', namespace)
            await next()
        })
        app.route('/api', createHubSettingsRoutes(dataDir))
        return { app, dataDir }
    }

    it('returns default off for emit, chat display, and stock peer spawn defaults', async () => {
        const { app } = await createApp()
        const response = await app.request('/api/hub-settings')
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })
    })

    it('persists emit toggle for owner without changing display', async () => {
        const { app } = await createApp()
        const put = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionSummaryContract: true })
        })
        expect(put.status).toBe(200)
        expect(await put.json()).toEqual({
            sessionSummaryContract: true,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })

        const get = await app.request('/api/hub-settings')
        expect(await get.json()).toEqual({
            sessionSummaryContract: true,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })
    })

    it('persists chat display toggle for owner without changing emit', async () => {
        const { app, dataDir } = await createApp()
        await writeSessionSummaryContractEnabled(dataDir, true)

        const put = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionSummaryInChat: true })
        })
        expect(put.status).toBe(200)
        expect(await put.json()).toEqual({
            sessionSummaryContract: true,
            sessionSummaryInChat: true,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })
    })

    it('persists peer spawn defaults', async () => {
        const { app } = await createApp()
        const put = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                peerSpawnDefaults: {
                    agent: 'cursor',
                    permissionMode: 'yolo',
                    models: { cursor: 'auto' }
                }
            })
        })
        expect(put.status).toBe(200)
        expect(await put.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: false,
            peerSpawnDefaults: {
                agent: 'cursor',
                permissionMode: 'yolo',
                models: {
                    claude: 'sonnet',
                    cursor: 'auto'
                }
            },
            sessionStartTimeoutMs: null
        })
    })

    it('rejects invalid body', async () => {
        const { app } = await createApp()
        const response = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionSummaryContract: 'yes' })
        })
        expect(response.status).toBe(400)
    })

    it('rejects empty body', async () => {
        const { app } = await createApp()
        const response = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(response.status).toBe(400)
    })

    it('rejects non-default namespaces for PUT but allows GET', async () => {
        const { app, dataDir } = await createApp('default')
        await writeSessionSummaryInChatEnabled(dataDir, true)

        const tenantApp = new Hono<WebAppEnv>()
        tenantApp.use('*', async (c, next) => {
            c.set('namespace', 'tenant')
            await next()
        })
        tenantApp.route('/api', createHubSettingsRoutes(dataDir))

        const get = await tenantApp.request('/api/hub-settings')
        expect(get.status).toBe(200)
        expect(await get.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: true,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })

        const put = await tenantApp.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionSummaryContract: true })
        })
        expect(put.status).toBe(403)
    })

    it('persists the session start timeout and clears it with null', async () => {
        const { app } = await createApp()

        const put = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionStartTimeoutMs: 60_000 })
        })
        expect(put.status).toBe(200)
        expect(await put.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: 60_000
        })

        const get = await app.request('/api/hub-settings')
        expect(await get.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: 60_000
        })

        const cleared = await app.request('/api/hub-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionStartTimeoutMs: null })
        })
        expect(await cleared.json()).toEqual({
            sessionSummaryContract: false,
            sessionSummaryInChat: false,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })
    })

    it('rejects a session start timeout outside the supported range', async () => {
        const { app } = await createApp()
        for (const value of [1_000, 24 * 60 * 60 * 1000, 30.5]) {
            const response = await app.request('/api/hub-settings', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionStartTimeoutMs: value })
            })
            expect(response.status).toBe(400)
        }
    })

    it('clamps an out-of-range value that reached settings.json another way', async () => {
        const { app, dataDir } = await createApp()
        await updateSettings(getSettingsFile(dataDir), (current) => ({
            settings: { ...current, sessionStartTimeoutMs: 24 * 60 * 60 * 1000 },
            result: null
        }))
        const response = await app.request('/api/hub-settings')
        expect((await response.json() as { sessionStartTimeoutMs: number }).sessionStartTimeoutMs)
            .toBe(SESSION_START_TIMEOUT_MS_MAX)
    })

    it('survives a prior write via settings helpers', async () => {
        const { app, dataDir } = await createApp()
        await writeSessionSummaryContractEnabled(dataDir, true)
        await writeSessionSummaryInChatEnabled(dataDir, true)
        const response = await app.request('/api/hub-settings')
        expect(await response.json()).toEqual({
            sessionSummaryContract: true,
            sessionSummaryInChat: true,
            peerSpawnDefaults: stockPeerSpawnDefaults,
            sessionStartTimeoutMs: null
        })
    })
})
