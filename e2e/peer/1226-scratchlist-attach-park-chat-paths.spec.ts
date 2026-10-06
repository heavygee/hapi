/*
 * Peer-stack e2e for tiann/hapi#1226 - attach via chat upload BEFORE enabling
 * scratchlist mode, park, then disgorge; image must survive.
 * Fork main only - run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence: MP4 (multi-step attach -> mode -> park -> queue).
 */

import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
// run-e2e-on-peer-stack.mjs cwd is always the mirror.
const mirrorRoot = process.env.HAPI_MIRROR ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1226-attach-park-peer.png')
const FIXTURE_PNG = resolve(artifactRoot, 'localdocs/playwright-runs/1226-fixture.png')

/** Minimal valid 1x1 PNG */
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
)

function assertPeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree … '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

/**
 * Peer seed emits session-alive then closes the socket; hub marks the session
 * inactive. Chat uploads require an active session (attachmentAdapter is
 * undefined otherwise). Hold a CLI socket for the duration of the test.
 */
async function holdSessionAlive(
    hub: string,
    token: string,
    sid: string,
): Promise<() => void> {
    const requireFromCli = createRequire(resolve(mirrorRoot, 'cli/package.json'))
    const { io } = requireFromCli('socket.io-client') as typeof import('socket.io-client')
    const uploadDir = mkdtempSync(join(tmpdir(), 'hapi-blobs-1226-'))
    const socket = io(`${hub}/cli`, {
        transports: ['websocket'],
        auth: { token, sessionId: sid },
        reconnection: true,
    })

    // Chat /upload is RPC to the CLI. Register a minimal uploadFile handler so
    // attach-before-scratchlist-mode can exercise the real chat adapter path.
    socket.on('rpc-request', async (
        data: { method: string; params: string },
        callback: (response: string) => void,
    ) => {
        try {
            if (data.method === `${sid}:uploadFile`) {
                const params = JSON.parse(data.params) as {
                    filename?: string
                    content?: string
                }
                const safe = (params.filename ?? 'upload').replace(/[/\\]/g, '_').slice(0, 80)
                const filePath = join(uploadDir, `${Date.now()}-${safe}`)
                writeFileSync(filePath, Buffer.from(params.content ?? '', 'base64'))
                callback(JSON.stringify({ success: true, path: filePath }))
                return
            }
            if (data.method === `${sid}:deleteUpload`) {
                const params = JSON.parse(data.params) as { path?: string }
                if (params.path?.startsWith(uploadDir)) {
                    try { rmSync(params.path, { force: true }) } catch { /* ignore */ }
                }
                callback(JSON.stringify({ success: true }))
                return
            }
            callback(JSON.stringify({ error: 'Method not found' }))
        } catch (error) {
            callback(JSON.stringify({
                error: error instanceof Error ? error.message : 'rpc failed',
            }))
        }
    })

    await new Promise<void>((resolveAlive, reject) => {
        const fail = (err: unknown) => {
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        socket.on('connect_error', fail)
        socket.on('connect', () => {
            socket.emit('rpc-register', { method: `${sid}:uploadFile` })
            socket.emit('rpc-register', { method: `${sid}:deleteUpload` })
            socket.emit('session-alive', {
                sid,
                time: Date.now(),
                thinking: false,
                mode: 'remote',
            })
            socket.emit('session-ready', { sid, time: Date.now() })
            resolveAlive()
        })
    })
    const heartbeat = setInterval(() => {
        socket.emit('session-alive', {
            sid,
            time: Date.now(),
            thinking: false,
            mode: 'remote',
        })
    }, 10_000)
    return () => {
        clearInterval(heartbeat)
        socket.close()
        try { rmSync(uploadDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
}

async function gotoRealSession(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.getByRole('button', { name: 'Scratchlist drawer' }).waitFor({ state: 'visible', timeout: 60_000 })

    const gotIt = page.getByRole('button', { name: 'Got it' })
    if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await gotIt.click()
    }

    await expect(page.getByText('This session is inactive')).toHaveCount(0, { timeout: 60_000 })
}

test.describe('scratchlist attach-before-mode park keeps image - peer stack (#1226)', () => {
    test.beforeEach(() => {
        assertPeerEnv()
        mkdirSync(dirname(FIXTURE_PNG), { recursive: true })
        writeFileSync(FIXTURE_PNG, PNG_1X1)
    })

    test('attach then enable scratchlist then park then disgorge keeps attachment', async ({ page }) => {
        test.setTimeout(180_000)
        const releaseAlive = await holdSessionAlive(hubUrl, accessToken, sessionId)
        try {
            await gotoRealSession(page)

            const uploadSeen = page.waitForRequest(
                (req) => req.method() === 'POST' && /\/upload$/.test(new URL(req.url()).pathname),
                { timeout: 60_000 },
            )
            const fileChooserPromise = page.waitForEvent('filechooser')
            await page.getByRole('button', { name: 'Attach file' }).click()
            const chooser = await fileChooserPromise
            await chooser.setFiles(FIXTURE_PNG)
            await uploadSeen

            await expect(page.getByLabel('Remove attachment')).toBeVisible({ timeout: 60_000 })
            await expect(page.getByText('Upload failed')).toHaveCount(0)

            const toggle = page.getByRole('button', { name: 'Scratchlist drawer' })
            await toggle.click()
            await expect(toggle).toHaveAttribute('aria-pressed', 'true')
            await expect(page.getByTestId('scratchlist-drawer')).toBeVisible()

            const parkText = `1226 park keep image ${Date.now()}`
            const composer = page.getByPlaceholder('Type a message...')
            await composer.fill(parkText)

            const scratchlistUpload = page.waitForRequest(
                (req) => req.method() === 'POST' && req.url().includes('/scratchlist/upload'),
                { timeout: 60_000 },
            )
            const scratchlistCreate = page.waitForRequest(
                (req) => req.method() === 'POST' && /\/scratchlist$/.test(new URL(req.url()).pathname),
                { timeout: 60_000 },
            )
            await expect(page.getByRole('button', { name: 'Send to scratchlist' })).toBeEnabled({
                timeout: 30_000,
            })
            await page.getByRole('button', { name: 'Send to scratchlist' }).click()
            await scratchlistUpload
            const createReq = await scratchlistCreate
            const createBody = createReq.postDataJSON() as {
                text?: string
                attachments?: Array<{ path?: string }>
            }
            expect(createBody.text).toContain('1226 park keep image')
            expect(createBody.attachments?.length).toBeGreaterThan(0)
            expect(createBody.attachments?.[0]?.path).toMatch(/^hapi-hub:scratchlist\//)

            await expect(page.getByTestId('scratchlist-entry')).toContainText(parkText, { timeout: 30_000 })
            await expect(page.getByTestId('scratchlist-attachment-thumbs')).toBeVisible({ timeout: 30_000 })
            await expect(page.getByTestId('scratchlist-attachment-thumb')).toHaveCount(1)

            await page.getByRole('button', { name: 'Send to queue' }).first().click()
            await expect(page.getByTestId('scratchlist-entry')).toHaveCount(0, { timeout: 30_000 })
            await expect(page.getByText(parkText).first()).toBeVisible({ timeout: 60_000 })

            mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
            await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
        } finally {
            releaseAlive()
        }
    })
})
