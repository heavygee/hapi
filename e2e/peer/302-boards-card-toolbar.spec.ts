/*
 * Peer-stack proof for heavygee/hapi#302 — Refresh + New card sit on the
 * title-filter row (card-list chrome), not board-switcher chrome; New card
 * is an outlined square-plus with tooltip.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=0 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/boards-toolbar-302 \
 *     --name boards-302-toolbar \
 *     e2e/peer/302-boards-card-toolbar.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_TOOLBAR = resolve(artifactRoot, 'localdocs/playwright-runs/302-boards-card-toolbar.png')

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error('Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree boards-toolbar-302')
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

async function gotoSessions(page: Page): Promise<void> {
    await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
}

test.describe('boards card-list toolbar — peer stack (#302)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('filter row hosts Refresh + outlined New card', async ({ page }) => {
        mkdirSync(dirname(PNG_TOOLBAR), { recursive: true })

        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoSessions(page)

        const modeSwitch = page.getByRole('radiogroup', { name: /Switch between sessions and (to-do|boards) view/i })
        await expect(modeSwitch).toBeVisible({ timeout: 60_000 })
        const boardsButton = modeSwitch.getByRole('radio', { name: /Boards|To-Do/i })
        await boardsButton.click()

        const filter = page.getByPlaceholder(/Filter by title/i)
        await expect(filter).toBeVisible({ timeout: 60_000 })
        const refresh = page.getByRole('button', { name: 'Refresh' })
        const newCard = page.getByRole('button', { name: 'New card' })
        await expect(refresh).toBeVisible()
        await expect(newCard).toBeVisible()
        await expect(newCard).toHaveAttribute('title', 'New card')

        const filterBox = await filter.boundingBox()
        const refreshBox = await refresh.boundingBox()
        const newCardBox = await newCard.boundingBox()
        expect(filterBox && refreshBox && newCardBox).toBeTruthy()
        // Same horizontal band as the filter (card-list row), not above the board chips.
        expect(Math.abs((refreshBox!.y + refreshBox!.height / 2) - (filterBox!.y + filterBox!.height / 2))).toBeLessThan(12)
        expect(Math.abs((newCardBox!.y + newCardBox!.height / 2) - (filterBox!.y + filterBox!.height / 2))).toBeLessThan(12)
        expect(refreshBox!.x).toBeGreaterThan(filterBox!.x + filterBox!.width - 8)
        expect(newCardBox!.x).toBeGreaterThan(refreshBox!.x)

        const list = page.getByTestId('board-item-list')
        await dwellForHuman(900)
        await list.screenshot({ path: PNG_TOOLBAR })
    })
})
