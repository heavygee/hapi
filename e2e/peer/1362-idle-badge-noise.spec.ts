/*
 * Peer-stack e2e for tiann/hapi#1362 — drop Idle session-list badge.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Asserts quiet active rows show no Idle text/dot; with pin on, only working/pending
 * land in In progress while quiet actives stay in directory groups.
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = process.env.HAPI_MIRROR ?? process.cwd()

const PNG_DEFAULT = resolve(artifactRoot, 'localdocs/playwright-runs/1362-idle-badge-after-default.png')
const PNG_PIN_ON = resolve(artifactRoot, 'localdocs/playwright-runs/1362-idle-badge-after-pin-on.png')

const runId = `${Date.now()}`
const WORKING_TITLE = `Peer1362 Working ${runId}`
const QUIET_TITLE = `Peer1362 Quiet ${runId}`
const WORKING_PATH = `/tmp/peer1362-working-${runId}`
const QUIET_PATH = `/tmp/peer1362-quiet-${runId}`

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree … '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function createSession(title: string, path: string): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1362-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path,
                host: hostname(),
                flavor: 'cursor',
                name: title,
            },
            agentState: { requests: {}, completedRequests: {} },
        }),
    })
    if (!res.ok) {
        throw new Error(`POST /cli/sessions failed (${res.status}): ${await res.text()}`)
    }
    const data = await res.json() as { session?: { id?: string } }
    const sessionId = data.session?.id
    if (!sessionId) {
        throw new Error(`unexpected /cli/sessions response: ${JSON.stringify(data)}`)
    }
    return sessionId
}

async function holdSessionAlive(
    hub: string,
    token: string,
    sid: string,
    thinking: boolean,
): Promise<() => void> {
    const requireFromCli = createRequire(resolve(mirrorRoot, 'cli/package.json'))
    const { io } = requireFromCli('socket.io-client') as typeof import('socket.io-client')
    const socket = io(`${hub}/cli`, {
        transports: ['websocket'],
        auth: { token, sessionId: sid },
        reconnection: true,
    })

    await new Promise<void>((resolveReady, reject) => {
        const fail = (err: unknown) => {
            socket.close()
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        socket.on('connect_error', fail)
        socket.on('connect', () => {
            const pulse = () => {
                socket.emit('session-alive', {
                    sid,
                    time: Date.now(),
                    thinking,
                    mode: 'remote',
                })
            }
            pulse()
            socket.emit('session-ready', { sid, time: Date.now() })
            const interval = setInterval(pulse, 2000)
            socket.once('disconnect', () => clearInterval(interval))
            resolveReady()
        })
    })

    return () => {
        socket.close()
    }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        try {
            localStorage.setItem(key, token)
            if (!sessionStorage.getItem('hapi.e2e.1362.prefsSeeded')) {
                localStorage.removeItem('hapi-pin-in-progress-sessions')
                localStorage.removeItem('hapi-show-active-sessions-only')
                sessionStorage.setItem('hapi.e2e.1362.prefsSeeded', '1')
            }
        } catch {
            // about:blank opaque origin
        }
    }, { key: storageKey, token: accessToken })
}

async function gotoSessions(page: Page): Promise<void> {
    await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }
}

async function shot(page: Page, path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true })
    const target = page.locator('main, body').first()
    try {
        await target.screenshot({ path, timeout: 15_000 })
    } catch {
        await page.screenshot({ path, fullPage: false, timeout: 15_000 })
    }
}

test.describe('drop Idle session-list badge — peer stack (#1362)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('quiet actives have no Idle label; pin keeps them in directories', async ({ page }) => {
        mkdirSync(dirname(PNG_DEFAULT), { recursive: true })

        const workingId = await createSession(WORKING_TITLE, WORKING_PATH)
        const quietId = await createSession(QUIET_TITLE, QUIET_PATH)
        const releaseWorking = await holdSessionAlive(hubUrl, accessToken, workingId, true)
        const releaseQuiet = await holdSessionAlive(hubUrl, accessToken, quietId, false)

        try {
            await injectAuth(page)
            await gotoSessions(page)

            await expect(page.getByRole('button', { name: new RegExp(WORKING_TITLE) }).first()).toBeVisible({ timeout: 60_000 })
            await expect(page.getByRole('button', { name: new RegExp(QUIET_TITLE) }).first()).toBeVisible()

            // Default OFF: no Idle badge noise on quiet active rows.
            await expect(page.getByTitle('In progress')).toHaveCount(0)
            await expect(page.getByText('Idle', { exact: true })).toHaveCount(0)
            await expect(page.getByTitle('Idle', { exact: true })).toHaveCount(0)
            await expect(page.locator(`div.group\\/project[title="${QUIET_PATH}"]`)).toBeVisible()
            await shot(page, PNG_DEFAULT)

            await page.goto('/settings/display', { waitUntil: 'domcontentloaded', timeout: 60_000 })
            const pinToggle = page.getByRole('checkbox', { name: 'Pin in-progress sessions' })
            await expect(pinToggle).toBeVisible({ timeout: 30_000 })
            await pinToggle.check({ force: true })
            await expect(pinToggle).toBeChecked()

            await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
            await expect(page.getByTitle('In progress')).toBeVisible({ timeout: 60_000 })
            await expect(page.getByText(/Running \(1\)/)).toBeVisible()
            await expect(page.getByText(/Idle \(/)).toHaveCount(0)
            await expect(page.getByText('Idle', { exact: true })).toHaveCount(0)
            // Quiet active stays under its project directory.
            await expect(page.locator(`div.group\\/project[title="${QUIET_PATH}"]`)).toBeVisible()
            await expect(page.getByRole('button', { name: new RegExp(QUIET_TITLE) }).first()).toBeVisible()
            await shot(page, PNG_PIN_ON)
        } finally {
            releaseWorking()
            releaseQuiet()
        }
    })
})
