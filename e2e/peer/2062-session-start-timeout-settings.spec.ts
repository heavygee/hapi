/*
 * Peer-stack e2e for tiann/hapi#2062 — Settings control for the session-start
 * (webhook) timeout that slow hosts hit on Create Session.
 * Fork main only — never commit into the upstream PR branch.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/webhook-timeout-settings-2062 \
 *     --name webhook-timeout-2062 \
 *     e2e/peer/2062-session-start-timeout-settings.spec.ts
 *
 * Evidence tier: PNG + MP4. The control's point is the save round-trip
 * (type → Save → "Saved" → survives reload → Use default clears it), which a
 * single still cannot show.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

/**
 * Human pacing for the screencast. The pointer/action overlay itself comes
 * from `video: annotatedVideoUseOption(...)` in the mirror playwright.config;
 * these two mirror `clickForHuman` / `dwellForHuman` in
 * scripts/dev/playwright-annotated-video.mjs, inlined because Playwright
 * transpiles a dynamic import of that .mjs from a spec into CJS
 * ("exports is not defined in ES module scope").
 */
const HUMAN_DWELL_MS = 1000

async function dwellForHuman(page: Page, ms: number = HUMAN_DWELL_MS): Promise<void> {
    await page.waitForTimeout(ms)
}

async function clickForHuman(
    locator: import('@playwright/test').Locator,
    options: { waitFor?: () => Promise<unknown>; dwellMs?: number } = {}
): Promise<void> {
    await locator.click()
    if (options.waitFor) {
        await options.waitFor()
    }
    await dwellForHuman(locator.page(), options.dwellMs ?? HUMAN_DWELL_MS)
}

const PNG_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/2062-session-start-timeout.png')
const PNG_SAVED = resolve(artifactRoot, 'localdocs/playwright-runs/2062-session-start-timeout-saved.png')

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree webhook-timeout-settings-2062'
        )
    }
}

async function authHeaders(): Promise<Record<string, string>> {
    const auth = await fetch(`${hubUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    })
    if (auth.ok) {
        const body = await auth.json() as { token?: string }
        if (body.token) {
            return { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' }
        }
    }
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

async function readHubSessionStartTimeout(): Promise<number | null> {
    const res = await fetch(`${hubUrl}/api/hub-settings`, { headers: await authHeaders() })
    if (!res.ok) {
        throw new Error(`GET /api/hub-settings failed (${res.status}): ${await res.text()}`)
    }
    const body = await res.json() as { sessionStartTimeoutMs?: number | null }
    return body.sessionStartTimeoutMs ?? null
}

async function gotoMachineSettings(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
        localStorage.setItem('hapi.fue.v1.disabled', '1')
    }, { key: storageKey, token: accessToken })

    await page.goto('/settings/machines', { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        await page.goto('/settings/machines', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
}

test.describe('session start timeout setting — peer stack (#2062)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('operator can raise, persist and clear the session start timeout', async ({ page }) => {
        mkdirSync(dirname(PNG_PATH), { recursive: true })

        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoMachineSettings(page)

        // 1. The control exists, documents its range, and names the env override.
        const heading = page.getByRole('heading', { name: 'Session start timeout' })
        await expect(heading).toBeVisible({ timeout: 60_000 })
        const timeoutInput = page.getByRole('spinbutton')
        await expect(timeoutInput).toBeEnabled({ timeout: 30_000 })
        await expect(timeoutInput).toHaveValue('')
        await expect(timeoutInput).toHaveAttribute('placeholder', '15')
        await expect(page.getByText(/Between 5 and 300 seconds/)).toBeVisible()
        await expect(page.getByText(/HAPI_RUNNER_WEBHOOK_TIMEOUT_MS/)).toBeVisible()
        await dwellForHuman(page, 1000)
        await page.screenshot({ path: PNG_PATH, fullPage: false })

        // 2. Raising it saves to the hub.
        await timeoutInput.click()
        await timeoutInput.fill('90')
        await dwellForHuman(page, 600)
        await clickForHuman(page.getByRole('button', { name: 'Save' }), {
            waitFor: () => page.getByText('Saved. Applies to the next session you start.')
                .waitFor({ state: 'visible', timeout: 15_000 }),
        })
        await dwellForHuman(page, 1000)
        await page.screenshot({ path: PNG_SAVED, fullPage: false })
        expect(await readHubSessionStartTimeout()).toBe(90_000)

        // 3. It survives a reload — this is a persisted hub setting, not local state.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
        const reloadedInput = page.getByRole('spinbutton')
        await expect(reloadedInput).toHaveValue('90', { timeout: 30_000 })
        await dwellForHuman(page, 800)

        // 4. "Use default" clears the override so runners fall back to 15s.
        await clickForHuman(page.getByRole('button', { name: 'Use default' }), {
            waitFor: () => expect(page.getByRole('spinbutton')).toHaveValue('', { timeout: 15_000 }),
        })
        await dwellForHuman(page, 1200)
        expect(await readHubSessionStartTimeout()).toBeNull()
    })
})
