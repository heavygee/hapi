/*
 * Peer-stack e2e for tiann/hapi#2011 - terminal To agent / Selection to agent.
 * Fork main only - run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = process.env.HAPI_MIRROR ?? process.cwd()

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs with a seeded session '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function primeAuth(page: Page, opts?: { clearKeys?: string[] }): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    const clearKeys = opts?.clearKeys ?? []
    await page.addInitScript(({ key, token, clearKeys: keys, guardKey }) => {
        localStorage.setItem(key, token)
        if (!sessionStorage.getItem(guardKey)) {
            for (const k of keys) localStorage.removeItem(k)
            sessionStorage.setItem(guardKey, '1')
        }
    }, {
        key: storageKey,
        token: accessToken,
        clearKeys,
        guardKey: 'hapi.e2e.2011.fueSeeded',
    })
}

async function ensureAuthed(page: Page): Promise<void> {
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }
}

/**
 * Composer Terminal is gated on session.active. Peer seed activates then drops
 * the CLI socket after 500ms, so hold a live /cli connection for the FUE click.
 */
async function holdSessionActive(): Promise<() => void> {
    const requireFromCli = createRequire(resolve(mirrorRoot, 'cli/package.json'))
    const { io } = requireFromCli('socket.io-client') as typeof import('socket.io-client')
    const socket = io(`${hubUrl}/cli`, {
        transports: ['websocket'],
        auth: { token: accessToken, sessionId },
        reconnection: false,
        timeout: 15_000,
    })
    await new Promise<void>((resolvePromise, reject) => {
        const fail = (err: unknown) => {
            socket.close()
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        socket.on('connect_error', fail)
        socket.on('error', (payload) => fail(new Error(JSON.stringify(payload))))
        socket.on('connect', () => {
            socket.emit('session-alive', {
                sid: sessionId,
                time: Date.now(),
                thinking: false,
                mode: 'remote',
            })
            socket.emit('session-ready', {
                sid: sessionId,
                time: Date.now(),
            })
            resolvePromise()
        })
    })
    return () => {
        socket.close()
    }
}

test.describe('terminal to agent - peer stack (#2011)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('composer Terminal icon shows To agent FUE before navigating', async ({ page }) => {
        // Evidence tier: PNG - FUE on the composer entry point (navigation deferred until Got it).
        const release = await holdSessionActive()
        try {
            await page.setViewportSize({ width: 1280, height: 900 })
            await primeAuth(page, {
                clearKeys: [
                    'hapi.fue.v1.composer-terminal-to-agent',
                    'hapi.fue.v1.rich-composer-mentions',
                    'hapi.fue.v1.disabled',
                ],
            })
            await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
            await ensureAuthed(page)
            await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

            const terminalButton = page.getByRole('button', { name: 'Terminal', exact: true })
            await terminalButton.waitFor({ state: 'visible', timeout: 60_000 })
            await expect(terminalButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

            await terminalButton.click()
            const dialog = page.getByRole('dialog', { name: 'Send terminal to agent', exact: true })
            await expect(dialog).toBeVisible()
            await expect(dialog.getByText(/Selection to agent/i)).toBeVisible()

            mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
            await page.screenshot({
                path: resolve(artifactRoot, 'localdocs/playwright-runs/2011-composer-terminal-to-agent-fue.png'),
                fullPage: false,
            })

            await dialog.getByRole('button', { name: 'Got it' }).click()
            await expect(dialog).toHaveCount(0)
            await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/terminal`))
            const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.composer-terminal-to-agent'))
            expect(stored).toBe('1')
        } finally {
            release()
        }
    })

    test('shows To agent on the terminal control bar', async ({ page }) => {
        // Evidence tier: PNG - control presence (selection flip covered by unit tests).
        await page.setViewportSize({ width: 1280, height: 900 })
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.composer-terminal-to-agent'] })
        await page.addInitScript(() => {
            localStorage.setItem('hapi.fue.v1.composer-terminal-to-agent', '1')
        })
        await page.goto(`/sessions/${sessionId}/terminal`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })
        await ensureAuthed(page)
        await page.goto(`/sessions/${sessionId}/terminal`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        const toAgent = page.getByTestId('terminal-to-agent')
        await toAgent.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(toAgent).toHaveText('To agent')

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        const shotPath = resolve(artifactRoot, 'localdocs/playwright-runs/2011-terminal-to-agent.png')
        await page.screenshot({ path: shotPath, fullPage: false })
    })
})
