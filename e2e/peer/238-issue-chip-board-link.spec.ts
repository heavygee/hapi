/*
 * Peer-stack e2e for heavygee/hapi#238 follow-up (via Fekko) — reverse
 * session -\> board link. A session linked to a GitHub issue that's also
 * tracked on a board should show a small board affordance next to its issue
 * chip, and clicking it should jump into Boards mode on that exact item.
 *
 *   cd ~/coding/hapi && node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/boards-and-pr-awareness \
 *     --name boards-238-newcard --no-up \
 *     e2e/peer/238-issue-chip-board-link.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_LIST = resolve(artifactRoot, 'localdocs/playwright-runs/238-issue-chip-board-link-list.png')
const PNG_BOARD = resolve(artifactRoot, 'localdocs/playwright-runs/238-issue-chip-board-link-board.png')

test('session list issue chip shows a board affordance and jumps into Boards mode on click', async ({ page }) => {
    if (!hubUrl || !accessToken) {
        throw new Error('Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree boards-and-pr-awareness')
    }
    mkdirSync(dirname(PNG_LIST), { recursive: true })
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        try {
            localStorage.setItem(key, token)
            localStorage.setItem('hapi.fue.v1.disabled', '1')
            localStorage.setItem('hapi.fue.v1.boards-mode', '1')
            localStorage.setItem('hapi.onboarding.v1.shell-tour', '1')
        } catch {
            // about:blank
        }
    }, { key: storageKey, token: accessToken })

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }

    const issueChip = page.getByTestId('issue-ref-chip')
    await expect(issueChip).toBeVisible({ timeout: 30_000 })
    const boardLink = page.getByTestId('issue-ref-chip-board-link')
    await expect(boardLink).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: PNG_LIST })

    await boardLink.click()

    const modeSwitch = page.getByRole('radiogroup', { name: 'Switch between sessions and boards view' })
    await expect(modeSwitch.getByRole('radio', { name: /Boards/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Replace the lobby carpet tiles' })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: PNG_BOARD })
})
