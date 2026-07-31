/*
 * Peer-stack e2e for tiann/hapi#1272 — just-in-time composer terminal FUE.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree
 * <product worktree>. Requires a seeded session (unlike the shell-tour
 * spec, which needs --no-seed).
 *
 * The Create Session "Worktree" option originally had a matching FUE here
 * too, but operator review (#1272) called it out as redundant — the
 * always-visible inline description next to that radio already explains
 * it, so wrapping it in a click-to-reveal FUE added friction without
 * adding information. Removed; see newSession.type.worktree.desc instead.
 */

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
// Separate session seeded with agentState.controlledByUser=true — the
// switch-to-remote button only renders on a locally-controlled session,
// which the normal seed-peer-session.mjs path doesn't produce.
const controlledSessionId = process.env.HAPI_PEER_SESSION_ID_CONTROLLED ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs with a seeded session '
            + '(no --no-seed) or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function primeAuth(page: Page, opts: { clearKeys: string[] }): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token, clearKeys, guardKey }) => {
        localStorage.setItem(key, token)
        if (!sessionStorage.getItem(guardKey)) {
            for (const k of clearKeys) localStorage.removeItem(k)
            sessionStorage.setItem(guardKey, '1')
        }
    }, { key: storageKey, token: accessToken, clearKeys: opts.clearKeys, guardKey: 'hapi.e2e.1272.jitSeeded' })
}

test.describe('just-in-time FUEs — peer stack, seeded session (#1272)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('composer terminal button shows a dot + FUE callout on first click, clear of the toolbar', async ({ page }) => {
        // Evidence tier: PNG — static existence (dot + callout), same shape
        // as the existing scratchlist FUE precedent.
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.composer-terminal', 'hapi.fue.v1.disabled'] })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        }

        const terminalButton = page.getByRole('button', { name: 'Terminal', exact: true })
        await terminalButton.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(terminalButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

        await terminalButton.click()
        // Title dropped the "New:" prefix (operator feedback #1272: for a
        // first-time user everything is new, the label added no signal).
        const dialog = page.getByRole('dialog', { name: 'Remote terminal', exact: true })
        await expect(dialog).toBeVisible()

        // Regression guard for the operator-reported positioning bug: the
        // callout must not overlap the button that spawned it (previously
        // the placement math clamped against a hardcoded 96px height
        // estimate that under-counted the real panel, especially with the
        // secondary-action row added).
        const calloutBox = await dialog.boundingBox()
        const buttonBox = await terminalButton.boundingBox()
        expect(calloutBox).not.toBeNull()
        expect(buttonBox).not.toBeNull()
        if (calloutBox && buttonBox) {
            const overlaps = !(
                calloutBox.x + calloutBox.width <= buttonBox.x
                || buttonBox.x + buttonBox.width <= calloutBox.x
                || calloutBox.y + calloutBox.height <= buttonBox.y
                || buttonBox.y + buttonBox.height <= calloutBox.y
            )
            expect(overlaps).toBe(false)
        }

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-composer-terminal-fue.png'),
            fullPage: false,
        })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)
        const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.composer-terminal'))
        expect(stored).toBe('1')
    })

    test('composer per-session settings gear shows a dot + FUE callout', async ({ page }) => {
        // Evidence tier: PNG — same safe click-through shape as scratchlist
        // (toggling the panel is a local boolean flip, no navigation).
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.composer-per-session-settings', 'hapi.fue.v1.disabled'] })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        }

        // "Settings" collides with the sidebar's global settings icon on
        // desktop split-pane (same accessible name) — the composer's gear
        // renders after the sidebar in DOM order, so .last() is the
        // composer one.
        const settingsButton = page.getByRole('button', { name: 'Settings', exact: true }).last()
        await settingsButton.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(settingsButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

        await settingsButton.click()
        const dialog = page.getByRole('dialog', { name: 'Session settings', exact: true })
        await expect(dialog).toBeVisible()

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-composer-settings-fue.png'),
            fullPage: false,
        })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)
        const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.composer-per-session-settings'))
        expect(stored).toBe('1')
    })

    test('composer schedule-send button shows the explainer first, then opens the real picker on confirm', async ({ page }) => {
        // Evidence tier: PNG keyframes for both states — the whole point is
        // that the FUE callout and the real ScheduleTimePicker never occupy
        // the same anchor at once.
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.composer-schedule-send', 'hapi.fue.v1.disabled'] })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        }

        const scheduleButton = page.getByRole('button', { name: 'Schedule send', exact: true })
        await scheduleButton.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(scheduleButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

        await scheduleButton.click()
        const dialog = page.getByRole('dialog', { name: 'Schedule for later', exact: true })
        await expect(dialog).toBeVisible()

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-composer-schedule-fue-before.png'),
            fullPage: false,
        })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)
        // Confirming opens the real time picker — proves the delayed-action
        // handoff actually works, not just that the explainer renders.
        await expect(page.locator('text=/schedule|send at|pick a time/i').first()).toBeVisible({ timeout: 10_000 })

        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-composer-schedule-fue-after.png'),
            fullPage: false,
        })

        const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.composer-schedule-send'))
        expect(stored).toBe('1')
    })

    test('session header Outline toggle shows a dot + FUE callout', async ({ page }) => {
        // Evidence tier: PNG — same safe click-through shape as Files toggle.
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.session-outline-toggle', 'hapi.fue.v1.disabled'] })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        }

        const outlineButton = page.getByRole('button', { name: 'Conversation outline', exact: true })
        await outlineButton.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(outlineButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

        await outlineButton.click()
        const dialog = page.getByRole('dialog', { name: 'Jump to any message', exact: true })
        await expect(dialog).toBeVisible()

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-session-outline-fue.png'),
            fullPage: false,
        })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)
        const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.session-outline-toggle'))
        expect(stored).toBe('1')
    })

    test('composer switch-to-remote button shows explainer first, then performs the switch on confirm', async ({ page }) => {
        // Evidence tier: PNG — requires a session seeded with
        // agentState.controlledByUser=true (see controlledSessionId above).
        test.skip(!controlledSessionId, 'requires HAPI_PEER_SESSION_ID_CONTROLLED')
        await primeAuth(page, { clearKeys: ['hapi.fue.v1.composer-switch-remote', 'hapi.fue.v1.disabled'] })
        await page.goto(`/sessions/${controlledSessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        }

        const switchButton = page.getByRole('button', { name: 'Switch to remote mode', exact: true })
        await switchButton.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(switchButton.getByRole('status', { name: 'New feature available' })).toBeVisible()

        await switchButton.click()
        const dialog = page.getByRole('dialog', { name: 'Switch to remote control', exact: true })
        await expect(dialog).toBeVisible()

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        await page.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1272-composer-switch-remote-fue.png'),
            fullPage: false,
        })

        await dialog.getByRole('button', { name: 'Got it' }).click()
        await expect(dialog).toHaveCount(0)
        const stored = await page.evaluate(() => localStorage.getItem('hapi.fue.v1.composer-switch-remote'))
        expect(stored).toBe('1')
    })
})
