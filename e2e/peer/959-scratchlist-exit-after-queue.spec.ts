/*
 * Peer-stack e2e for tiann/hapi#959 — real SessionChat UI on isolated hub.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/959-peer-stack.png')

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run: bun run test:e2e:peer (loads localdocs/peer-stack.env) '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
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
}

test.describe('scratchlist exit after queue send — peer stack (#959)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('successful promote-to-queue exits scratchlist mode on real SessionChat', async ({ page }) => {
        await gotoRealSession(page)

        const toggle = page.getByRole('button', { name: 'Scratchlist drawer' })
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByTestId('scratchlist-drawer')).toBeVisible()

        const composer = page.getByPlaceholder('Type a message...')
        await composer.fill('Queue this note from peer stack')
        await page.getByRole('button', { name: 'Send to scratchlist' }).click()
        await expect(page.getByText('Queue this note from peer stack')).toBeVisible()

        await page.getByRole('button', { name: 'Send to queue' }).first().click()

        await expect(page.getByTestId('scratchlist-entry')).toHaveCount(0)
        await expect(toggle).toHaveAttribute('aria-pressed', 'false')
        await expect(page.getByTestId('scratchlist-drawer')).toHaveCount(0)
        await expect(page.getByText('Queue this note from peer stack')).toBeVisible()

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    })
})
