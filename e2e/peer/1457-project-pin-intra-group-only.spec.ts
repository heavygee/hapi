/*
 * Visual proof for tiann/hapi#1457:
 * With pin-in-progress ON, In progress stays above project-pin directory
 * groups. Project pin remains first inside its folder; among-group pin
 * promotion may still place pin-containing folders before other groups.
 *
 * Run from mirror:
 *   cd ~/coding/hapi && node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/project-pin-intra-group-only \
 *     --name project-pin-intra-group-only --keep \
 *     e2e/peer/1457-project-pin-intra-group-only.spec.ts
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
const PNG_ORDER = resolve(OUT, '1457-project-pin-intra-group-only.png')

const runId = `${Date.now()}`
const PROJECT_PIN_TITLE = `Proof1457 ProjectPin ${runId}`
const PROJECT_IDLE_TITLE = `Proof1457 ProjectIdle ${runId}`
const FLOATER_TITLE = `Proof1457 Floater ${runId}`
const OTHER_IDLE_TITLE = `Proof1457 OtherIdle ${runId}`
const PROJECT_PIN_PATH = `/tmp/proof1457-pinned-${runId}`
const OTHER_PATH = `/tmp/proof1457-other-${runId}`

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
            tag: `proof1457-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function webJwt(): Promise<string> {
    const res = await fetch(`${hubUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    })
    if (!res.ok) {
        throw new Error(`POST /api/auth failed: ${res.status} ${await res.text()}`)
    }
    const body = await res.json() as { token?: string }
    if (!body.token) {
        throw new Error(`POST /api/auth missing token: ${JSON.stringify(body)}`)
    }
    return body.token
}

async function setPinMode(sessionId: string, mode: 'none' | 'project' | 'global'): Promise<void> {
    const jwt = await webJwt()
    const res = await fetch(`${hubUrl}/api/sessions/${sessionId}/pin`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode }),
    })
    if (!res.ok) {
        throw new Error(`PUT /api/sessions/:id/pin failed (${res.status}): ${await res.text()}`)
    }
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
            localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
            localStorage.removeItem('hapi-show-active-sessions-only')
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

test.describe('1457 project pin intra-group only', () => {
    test('In progress precedes project-pin groups; pin stays first inside group', async ({ page }) => {
        requirePeerEnv()
        mkdirSync(OUT, { recursive: true })
        await page.setViewportSize({ width: 1280, height: 900 })

        const projectPinId = await createSession(PROJECT_PIN_TITLE, PROJECT_PIN_PATH)
        await createSession(PROJECT_IDLE_TITLE, PROJECT_PIN_PATH)
        const floaterId = await createSession(FLOATER_TITLE, OTHER_PATH)
        await createSession(OTHER_IDLE_TITLE, OTHER_PATH)
        await setPinMode(projectPinId, 'project')
        const release = await holdSessionAliveThinking(hubUrl, accessToken, floaterId)

        try {
            await injectAuth(page)
            await gotoPath(page, '/sessions')

            const projectPinGroup = page.locator(`div.group\\/project[title="${PROJECT_PIN_PATH}"]`)
            const inProgress = page.getByTitle('In progress')
            const otherGroup = page.locator(`div.group\\/project[title="${OTHER_PATH}"]`)
            const projectPinRow = page.getByRole('button', { name: new RegExp(PROJECT_PIN_TITLE) }).first()
            const projectIdleRow = page.getByRole('button', { name: new RegExp(PROJECT_IDLE_TITLE) }).first()

            await expect(projectPinGroup).toBeVisible({ timeout: 60_000 })
            await expect(inProgress).toBeVisible({ timeout: 60_000 })
            await expect(otherGroup).toBeVisible({ timeout: 60_000 })
            await expect(projectPinRow).toBeVisible()
            await expect(page.getByRole('button', { name: new RegExp(FLOATER_TITLE) }).first()).toBeVisible()

            const pinBox = await projectPinGroup.boundingBox()
            const runningBox = await inProgress.boundingBox()
            const otherBox = await otherGroup.boundingBox()
            const pinRowBox = await projectPinRow.boundingBox()
            const idleRowBox = await projectIdleRow.boundingBox()
            if (!pinBox || !runningBox || !otherBox || !pinRowBox || !idleRowBox) {
                throw new Error('missing section/row bounding boxes')
            }
            // Section order: In progress above pin-containing directory groups.
            expect(runningBox.y).toBeLessThan(pinBox.y)
            expect(pinBox.y).toBeLessThan(otherBox.y)
            // Intra-group: project pin first inside its folder.
            expect(pinRowBox.y).toBeLessThan(idleRowBox.y)

            await inProgress.scrollIntoViewIfNeeded()
            await page.waitForTimeout(800)
            await page.screenshot({ path: PNG_ORDER, fullPage: false })
        } finally {
            release()
        }
    })
})
