/*
 * Peer-stack e2e for tiann/hapi#1756 — in-session content search.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Seeds a user message via CLI socket (indexes into FTS), opens the session,
 * uses header in-chat search, selects the ranked hit, and asserts the existing
 * locate / match-navigation chrome lands on that turn.
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const PNG_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1756-in-session-content-search.png')
const MP4_DIR = resolve(artifactRoot, 'localdocs/playwright-runs')

const runId = `${Date.now()}`
const TITLE = `Peer1756 InChatSearch ${runId}`
const NEEDLE = `zebraquill-${runId}`

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree … '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function createSession(): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1756-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: `/tmp/peer1756-${runId}`,
                host: hostname(),
                flavor: 'cursor',
                name: TITLE,
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

async function seedUserMessage(sessionId: string, text: string): Promise<() => void> {
    const requireFromCli = createRequire(resolve(mirrorRoot, 'cli/package.json'))
    const { io } = requireFromCli('socket.io-client') as typeof import('socket.io-client')
    const socket = io(`${hubUrl}/cli`, {
        transports: ['websocket'],
        auth: { token: accessToken, sessionId },
        reconnection: false,
    })
    await new Promise<void>((resolveReady, reject) => {
        const fail = (err: unknown) => {
            socket.close()
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        socket.on('connect_error', fail)
        socket.on('connect', () => {
            socket.emit('session-alive', {
                sid: sessionId,
                time: Date.now(),
                thinking: false,
                mode: 'remote',
            })
            socket.emit('session-ready', { sid: sessionId, time: Date.now() })
            socket.emit('message', {
                sid: sessionId,
                localId: `peer1756-${runId}`,
                message: {
                    role: 'user',
                    content: { type: 'text', text },
                    meta: { sentFrom: 'web' },
                },
            })
            resolveReady()
        })
    })
    // Keep the socket briefly so the hub finishes indexing before we tear down.
    await new Promise((r) => setTimeout(r, 250))
    return () => { socket.close() }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        try {
            localStorage.setItem(key, token)
            // Skip FUE callout so it does not cover the search panel.
            localStorage.setItem('hapi.fue.v1.disabled', '1')
        } catch {
            // about:blank opaque origin
        }
    }, { key: storageKey, token: accessToken })
}

async function gotoSession(page: Page, sessionId: string): Promise<void> {
    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
}

test.describe('in-session content search — peer stack (#1756)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('header search finds seeded text and jumps to the match', async ({ page }) => {
        mkdirSync(dirname(PNG_PATH), { recursive: true })
        mkdirSync(MP4_DIR, { recursive: true })
        await page.setViewportSize({ width: 1280, height: 900 })

        const sessionId = await createSession()
        const release = await seedUserMessage(sessionId, `Please remember the codeword ${NEEDLE} forever.`)

        try {
            await injectAuth(page)
            await gotoSession(page, sessionId)

            await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 60_000 })
            await expect(page.getByText(NEEDLE).first()).toBeVisible({ timeout: 60_000 })

            await page.getByTestId('session-in-chat-search-toggle').click()
            const input = page.getByTestId('session-in-chat-search-input')
            await expect(input).toBeVisible()
            await input.fill(NEEDLE)

            const hit = page.locator('[data-testid^="session-in-chat-search-hit-"]').first()
            await expect(hit).toBeVisible({ timeout: 30_000 })
            await hit.click()

            await expect(page.getByTestId('search-match-navigation')).toBeVisible({ timeout: 30_000 })
            await expect(page.getByTestId('search-match-navigation')).toContainText(NEEDLE)

            await page.screenshot({ path: PNG_PATH, fullPage: false })
        } finally {
            release()
        }
    })
})
