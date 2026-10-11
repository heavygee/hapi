/*
 * Peer-stack e2e for a GitHub Projects v2 "view" URL
 * (`.../projects/<n>/views/<v>`) as a supported add-board format — the view
 * restricts the content of the underlying project, and the restrictive view
 * is respected server-side (not just the plain project's unfiltered items).
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-235 \
 *     e2e/peer/235-todo-view-board.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_VIEW_BOARD = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-view-board.png')

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error('Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree todo-board-ui-worktrees/1009-14eb')
    }
}

async function injectAuth(page: Page): Promise<void> {
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
}

async function gotoTodoMode(page: Page): Promise<void> {
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
}

test.describe('GitHub Projects view URL as a restrictive board — peer stack (#238)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('adding a /views/<n> URL creates a separate, filtered board alongside the unfiltered one', async ({ page }) => {
        mkdirSync(dirname(PNG_VIEW_BOARD), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoTodoMode(page)

        // The demo board's "View 1" was live-configured (via updateProjectV2View)
        // to filter to status:"In Progress" only, ahead of this run.
        const addButton = page.getByRole('button', { name: 'Add a board' })
        await clickForHuman(addButton, {
            waitFor: () => page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await page.getByPlaceholder(/github.com/i).fill('https://github.com/users/heavygee/projects/6/views/1')
        await clickForHuman(page.getByRole('button', { name: 'Add', exact: true }), {
            waitFor: () => page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10_000 }),
        })

        // Adding a board doesn't auto-select it — switch to the new
        // view-scoped board explicitly, same as a real operator would.
        await page.getByRole('radio', { name: /HAPI Demo Board · View 1/i }).click()

        // The new view-scoped board is now selected and shows only the
        // in-progress items — "Reconcile the stationery cupboard inventory"
        // (Todo) and the Done items must NOT appear, proving the view's
        // filter was applied server-side, not just the whole project.
        // Scoped to the to-do item list itself: other peer-stack sessions
        // (spawned by earlier specs sharing this same stack) can carry the
        // same item title in an unrelated sidebar row.
        const itemList = page.getByTestId('todo-item-list')
        await expect(itemList.getByText('In Progress (2)')).toBeVisible({ timeout: 15_000 })
        await expect(itemList.getByText('Replace the lobby carpet tiles')).toBeVisible()
        await expect(itemList.getByText('Update the printer driver on the shared workstation')).toBeVisible()
        await expect(itemList.getByText('Reconcile the stationery cupboard inventory')).not.toBeVisible()
        await dwellForHuman(page, 1000)
        await page.screenshot({ path: PNG_VIEW_BOARD })

        // Switching back to the plain (unfiltered) board shows every status
        // group again — both boards coexist as separate list entries.
        await page.getByRole('radio', { name: /heavygee\/6$/ }).click()
        await expect(itemList.getByText('Reconcile the stationery cupboard inventory')).toBeVisible({ timeout: 15_000 })

        // Clean up: remove the view board so repeat runs start fresh. Label
        // uses the live-fetched project title ("HAPI Demo Board"), not the
        // pre-existing default board's hardcoded "heavygee/6" label.
        const removeViewBoard = page.getByRole('button', { name: /Remove HAPI Demo Board · View 1/i })
        if (await removeViewBoard.isVisible({ timeout: 2000 }).catch(() => false)) {
            await removeViewBoard.click()
            await page.getByRole('button', { name: 'Remove', exact: true }).click()
        }
    })
})
