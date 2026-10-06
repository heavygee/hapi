/*
 * Peer-stack e2e for tiann/hapi#1273 — rich-composer @-mention FUE + placeholder.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1273-rich-composer-fue.png')
const PLACEHOLDER =
    'Type what you want the agent to do, or @mention another session for context or handoff'
const FUE_TITLE = 'New: @mention another session'

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function gotoRealSession(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
        // Clear FUE ack once per tab (sessionStorage survives reload; localStorage
        // clear must not re-run after Got it or the ack would never stick).
        if (!sessionStorage.getItem('hapi.e2e.1273.fueSeeded')) {
            localStorage.removeItem('hapi.fue.v1.rich-composer-mentions')
            sessionStorage.setItem('hapi.e2e.1273.fueSeeded', '1')
        }
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.getByTestId('rich-composer-input').waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('rich-composer mentions FUE — peer stack (#1273)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('shows mention placeholder + FUE callout; Got it persists ack', async ({ page }) => {
        // Evidence tier: PNG — static existence (placeholder + callout); dismiss is one click.
        await gotoRealSession(page)

        const composer = page.getByTestId('rich-composer-input')
        await expect(composer).toHaveAttribute('aria-label', PLACEHOLDER)

        const dialog = page.getByRole('dialog', { name: FUE_TITLE })
        // Autofocus should engage; click as fallback for engines that skip focus events.
        if (!(await dialog.isVisible().catch(() => false))) {
            await composer.click()
        }
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await expect(dialog.getByText(/inspect_peer|ping_peer/)).toBeVisible()

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)

        const stored = await page.evaluate(() =>
            localStorage.getItem('hapi.fue.v1.rich-composer-mentions')
        )
        expect(stored).toBe('1')

        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByTestId('rich-composer-input').waitFor({ state: 'visible', timeout: 60_000 })
        await expect(page.getByRole('dialog', { name: FUE_TITLE })).toHaveCount(0)
        await expect(page.getByTestId('rich-composer-input')).toHaveAttribute('aria-label', PLACEHOLDER)
    })
})
