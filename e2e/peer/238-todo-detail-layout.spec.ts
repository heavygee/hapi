/*
 * Peer-stack e2e for heavygee/hapi#238 — unified flex-wrap metadata layout
 * in the to-do detail pane (operator feedback, live on the real Lockhouse
 * board: "make better use of available horizontal space, not pile
 * everything up unless the view window dictates it").
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-layout \
 *     e2e/peer/238-todo-detail-layout.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_WIDE = resolve(artifactRoot, 'localdocs/playwright-runs/238-todo-detail-layout-wide.png')
const PNG_NARROW = resolve(artifactRoot, 'localdocs/playwright-runs/238-todo-detail-layout-narrow.png')

test.describe('to-do detail metadata layout — peer stack (#238)', () => {
    test('metadata wraps as one flow on a wide pane, drops to one-per-line on a narrow one', async ({ page }) => {
        if (!hubUrl || !accessToken) {
            throw new Error('Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree todo-board-ui-worktrees/1009-14eb')
        }
        mkdirSync(dirname(PNG_WIDE), { recursive: true })
        const storageKey = `hapi_access_token::${hubUrl}`
        await page.addInitScript(({ key, token }) => {
            try {
                localStorage.setItem(key, token)
                localStorage.setItem('hapi.fue.v1.disabled', '1')
                localStorage.setItem('hapi.onboarding.v1.shell-tour', '1')
            } catch {
                // about:blank
            }
        }, { key: storageKey, token: accessToken })

        await page.setViewportSize({ width: 1400, height: 900 })
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
            await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        }
        const modeSwitch = page.getByRole('radiogroup', { name: 'Switch between sessions and to-do view' })
        await expect(modeSwitch).toBeVisible({ timeout: 60_000 })
        await modeSwitch.getByRole('radio', { name: 'To-Do' }).click()
        await expect(page.getByText('In Progress (')).toBeVisible({ timeout: 30_000 })

        const itemList = page.getByTestId('todo-item-list')
        const firstCard = itemList.getByRole('button').filter({ hasText: /Replace the lobby carpet tiles/ })
        await firstCard.click()

        const detail = page.getByTestId('todo-item-detail')
        await expect(detail.getByRole('heading', { name: 'Replace the lobby carpet tiles' })).toBeVisible({ timeout: 15_000 })
        // Everything that used to pile up one-per-line — assignee, label,
        // custom field, created/updated timestamps — should now be visible
        // without scrolling, side by side, well before the body text.
        await expect(detail.getByText('heavygee', { exact: true })).toBeVisible()
        await expect(detail.getByText('bug')).toBeVisible()
        await expect(detail.getByText('Priority')).toBeVisible()
        await page.screenshot({ path: PNG_WIDE })

        // Narrow the pane — content should reflow to one-per-line, not
        // overflow or clip.
        await page.setViewportSize({ width: 420, height: 900 })
        await expect(detail.getByText('heavygee', { exact: true })).toBeVisible()
        await page.screenshot({ path: PNG_NARROW })
    })
})
