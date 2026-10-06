/*
 * Honest visual proof for tiann/hapi#1350 / #1347:
 * 1) Settings → Display scrolled so "Pin in-progress sessions" is in frame
 * 2) Annotated video (HAPI_PEER_RECORD_VIDEO=1): sessions default OFF → toggle ON → In progress
 *
 * Run from mirror with peer stack up:
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/in-progress-optional \
 *     --name in-progress-optional --no-up --keep \
 *     e2e/peer/1347-pin-in-progress-proof.spec.ts
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = process.env.HAPI_MIRROR ?? process.cwd()

const OUT = resolve(artifactRoot, 'localdocs/playwright-runs')
const PNG_SETTINGS = resolve(OUT, '1347-pin-toggle-settings.png')
const PNG_BEFORE = resolve(OUT, '1347-pin-toggle-before.png')
const PNG_AFTER = resolve(OUT, '1347-pin-toggle-after.png')

const runId = `${Date.now()}`
const ACTIVE_TITLE = `Proof1347 Active ${runId}`
const IDLE_TITLE = `Proof1347 Idle ${runId}`
const ACTIVE_PATH = `/tmp/proof1347-alpha-${runId}`
const IDLE_PATH = `/tmp/proof1347-beta-${runId}`

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error('Missing peer stack env (HAPI_PEER_WEB_URL / HAPI_PEER_CLI_TOKEN)')
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
            tag: `proof1347-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    if (!sessionId) throw new Error(`unexpected /cli/sessions response: ${JSON.stringify(data)}`)
    return sessionId
}

async function holdSessionAliveThinking(hub: string, token: string, sid: string): Promise<() => void> {
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
    return () => { socket.close() }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        try {
            localStorage.setItem(key, token)
            if (!sessionStorage.getItem('hapi.e2e.1347.proofSeeded')) {
                localStorage.removeItem('hapi-pin-in-progress-sessions')
                localStorage.removeItem('hapi-show-active-sessions-only')
                sessionStorage.setItem('hapi.e2e.1347.proofSeeded', '1')
            }
        } catch { /* about:blank */ }
    }, { key: storageKey, token: accessToken })
}

async function gotoPath(page: Page, path: string): Promise<void> {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }
}

test.describe('1347 honest proof capture', () => {
    test('settings toggle visible + annotated toggle interaction', async ({ page }) => {
        // Evidence: HAPI_PEER_RECORD_VIDEO=1 (annotated via playwright.config) + PNG keyframes.
        requirePeerEnv()
        mkdirSync(OUT, { recursive: true })
        await page.setViewportSize({ width: 1280, height: 900 })

        const activeId = await createSession(ACTIVE_TITLE, ACTIVE_PATH)
        await createSession(IDLE_TITLE, IDLE_PATH)
        const release = await holdSessionAliveThinking(hubUrl, accessToken, activeId)

        try {
            await injectAuth(page)

            // --- BEFORE: directory glanceability ---
            await gotoPath(page, '/sessions')
            await expect(page.getByRole('button', { name: new RegExp(ACTIVE_TITLE) }).first()).toBeVisible({ timeout: 60_000 })
            await expect(page.getByTitle('In progress')).toHaveCount(0)
            await expect(page.locator(`div.group\\/project[title="${ACTIVE_PATH}"]`)).toBeVisible()
            await page.waitForTimeout(1000)
            // Full viewport of the sessions route (sidebar + list), not just the toolbar strip.
            await page.screenshot({ path: PNG_BEFORE, fullPage: false })

            // --- SETTINGS: scroll Sessions prefs into view ---
            await gotoPath(page, '/settings/display')
            const pinLabel = page.getByText('Pin in-progress sessions', { exact: true })
            await expect(pinLabel).toBeVisible({ timeout: 30_000 })
            const activeOnly = page.getByText('Active sessions only', { exact: true })
            await activeOnly.scrollIntoViewIfNeeded()
            await pinLabel.scrollIntoViewIfNeeded()
            await page.waitForTimeout(700)

            const pinToggle = page.getByRole('checkbox', { name: 'Pin in-progress sessions' })
            const boxActive = await activeOnly.boundingBox()
            const boxPin = await pinLabel.boundingBox()
            if (!boxActive || !boxPin) throw new Error('missing toggle label boxes')
            const top = Math.max(0, Math.min(boxActive.y, boxPin.y) - 24)
            const bottom = Math.max(boxActive.y + boxActive.height, boxPin.y + boxPin.height) + 80
            await page.screenshot({
                path: PNG_SETTINGS,
                clip: {
                    x: Math.max(0, Math.min(boxActive.x, boxPin.x) - 24),
                    y: top,
                    width: 720,
                    height: Math.min(360, bottom - top),
                },
            })

            await expect(pinToggle).not.toBeChecked()
            // Click the visible switch track so the annotated video shows a real hit.
            await pinToggle.locator('xpath=ancestor::label[1]').click()
            await expect(pinToggle).toBeChecked()
            await page.waitForTimeout(1000)

            // --- AFTER: pinned In progress ---
            await gotoPath(page, '/sessions')
            await expect(page.getByTitle('In progress')).toBeVisible({ timeout: 60_000 })
            await expect(page.getByRole('button', { name: new RegExp(ACTIVE_TITLE) }).first()).toBeVisible()
            await page.getByTitle('In progress').scrollIntoViewIfNeeded()
            await page.waitForTimeout(1000)
            await page.screenshot({ path: PNG_AFTER, fullPage: false })
            await page.waitForTimeout(800)
        } finally {
            release()
        }
    })
})
