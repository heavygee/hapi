/*
 * Peer-stack e2e for tiann/hapi#1347 — optional pinned In progress section.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence tier: PNG + short interaction clip — default OFF (directory groups)
 * vs Settings toggle ON (pinned In progress). Toggle is the story.
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

const PNG_DEFAULT_OFF = resolve(artifactRoot, 'localdocs/playwright-runs/1347-pin-in-progress-default-off.png')
const PNG_PIN_ON = resolve(artifactRoot, 'localdocs/playwright-runs/1347-pin-in-progress-on.png')
const PNG_SETTINGS = resolve(artifactRoot, 'localdocs/playwright-runs/1347-pin-in-progress-settings.png')

const runId = `${Date.now()}`
const ACTIVE_TITLE = `Peer1347 Active Alpha ${runId}`
const IDLE_TITLE = `Peer1347 Idle Beta ${runId}`
const ACTIVE_PATH = `/tmp/peer1347-alpha-project-${runId}`
const IDLE_PATH = `/tmp/peer1347-beta-project-${runId}`

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
            tag: `peer1347-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function holdSessionAliveThinking(
    hub: string,
    token: string,
    sid: string,
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
                    thinking: true,
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
            // Clear pin preference once per tab so Settings toggles survive later navigations.
            if (!sessionStorage.getItem('hapi.e2e.1347.prefsSeeded')) {
                localStorage.removeItem('hapi-pin-in-progress-sessions')
                localStorage.removeItem('hapi-show-active-sessions-only')
                sessionStorage.setItem('hapi.e2e.1347.prefsSeeded', '1')
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
    // Prefer element capture — full-page Chrome screenshots flake under peer-stack
    // headless with "Unable to capture screenshot" protocol errors.
    const target = page.locator('main, body').first()
    try {
        await target.screenshot({ path, timeout: 15_000 })
    } catch {
        await page.screenshot({ path, fullPage: false, timeout: 15_000 })
    }
}

test.describe('optional pin in-progress — peer stack (#1347)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('default keeps actives in directory groups; Settings toggle pins In progress', async ({ page }) => {
        mkdirSync(dirname(PNG_DEFAULT_OFF), { recursive: true })

        const activeId = await createSession(ACTIVE_TITLE, ACTIVE_PATH)
        await createSession(IDLE_TITLE, IDLE_PATH)
        const release = await holdSessionAliveThinking(hubUrl, accessToken, activeId)

        try {
            await injectAuth(page)
            await gotoSessions(page)

            await expect(page.getByRole('button', { name: new RegExp(ACTIVE_TITLE) }).first()).toBeVisible({ timeout: 60_000 })
            await expect(page.getByRole('button', { name: new RegExp(IDLE_TITLE) }).first()).toBeVisible()

            // Default OFF: no pinned section; active lives under its directory header.
            await expect(page.getByTitle('In progress')).toHaveCount(0)
            await expect(page.locator(`div.group\\/project[title="${ACTIVE_PATH}"]`)).toBeVisible()
            await shot(page, PNG_DEFAULT_OFF)

            await page.goto('/settings/display', { waitUntil: 'domcontentloaded', timeout: 60_000 })
            const pinToggle = page.getByRole('checkbox', { name: 'Pin in-progress sessions' })
            await expect(pinToggle).toBeVisible({ timeout: 30_000 })
            await expect(pinToggle).not.toBeChecked()
            await shot(page, PNG_SETTINGS)
            // Visual track sits over the sr-only input; force the real control.
            await pinToggle.check({ force: true })
            await expect(pinToggle).toBeChecked()

            await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
            await expect(page.getByTitle('In progress')).toBeVisible({ timeout: 60_000 })
            await expect(page.getByRole('button', { name: new RegExp(ACTIVE_TITLE) }).first()).toBeVisible()
            await shot(page, PNG_PIN_ON)
        } finally {
            release()
        }
    })
})
