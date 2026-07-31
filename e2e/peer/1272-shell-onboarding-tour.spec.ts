/*
 * Peer-stack e2e for tiann/hapi#1272 — app-shell first-run onboarding tour.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 * Requires the peer stack brought up with `--no-seed` (a genuinely empty
 * session list is what triggers the "new install" tour in the first place).
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1272-shell-tour-step1.png')

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs (peer stack must be '
            + '`hapi-peer-stack up --no-seed` for an empty install) or export HAPI_PEER_WEB_URL, '
            + 'HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function gotoEmptySessionsList(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
        // Clear the tour ack once per tab (sessionStorage survives reload;
        // addInitScript re-runs on every navigation, so an unconditional
        // localStorage clear here would wipe the ack this test writes right
        // before the reload that's supposed to prove it stuck).
        if (!sessionStorage.getItem('hapi.e2e.1272.tourSeeded')) {
            localStorage.removeItem('hapi.onboarding.v1.shell-tour')
            localStorage.removeItem('hapi.fue.v1.disabled')
            sessionStorage.setItem('hapi.e2e.1272.tourSeeded', '1')
        }
    }, { key: storageKey, token: accessToken })

    await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    // Empty-state CTA is the signal the (real) session list has loaded.
    await page.getByRole('button', { name: /new session|start session/i }).first()
        .waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('shell onboarding tour — peer stack, empty install (#1272)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('walks new-session → browse → settings, persists ack, never reappears', async ({ page }) => {
        // Evidence tier: MP4/GIF — this is an interaction story (3-step
        // guided walk + a "Got it" finish + persistence across reload),
        // not a single static frame. A PNG keyframe of step 1 is also
        // captured below for the existence receipt.
        await gotoEmptySessionsList(page)

        const step1 = page.getByRole('dialog', { name: 'Start a new session' })
        await expect(step1).toBeVisible({ timeout: 10_000 })
        await expect(step1.getByText(/spin up a new coding session/i)).toBeVisible()

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

        await step1.getByRole('button', { name: 'Next' }).click()
        const step2 = page.getByRole('dialog', { name: 'Browse your projects' })
        await expect(step2).toBeVisible()
        await expect(step1).toHaveCount(0)

        await step2.getByRole('button', { name: 'Next' }).click()
        const step3 = page.getByRole('dialog', { name: 'Settings' })
        await expect(step3).toBeVisible()

        // Last step's primary action reads "Got it", not "Next".
        await step3.getByRole('button', { name: 'Got it' }).click()
        await expect(step3).toHaveCount(0)

        const ack = await page.evaluate(() => localStorage.getItem('hapi.onboarding.v1.shell-tour'))
        expect(ack).toBe('1')

        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: /new session|start session/i }).first()
            .waitFor({ state: 'visible', timeout: 60_000 })
        await expect(page.getByRole('dialog', { name: 'Start a new session' })).toHaveCount(0)
    })

    test('"Skip tour" ends the walk immediately and persists the same ack', async ({ page }) => {
        // Evidence tier: PNG is enough here — the whole point is a single
        // before/after (skip link click removes the dialog for good).
        await gotoEmptySessionsList(page)

        const step1 = page.getByRole('dialog', { name: 'Start a new session' })
        await expect(step1).toBeVisible({ timeout: 10_000 })

        await step1.getByRole('button', { name: 'Skip tour' }).click()
        await expect(step1).toHaveCount(0)

        const ack = await page.evaluate(() => localStorage.getItem('hapi.onboarding.v1.shell-tour'))
        expect(ack).toBe('1')
    })
})
