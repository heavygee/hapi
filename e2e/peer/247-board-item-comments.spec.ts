/*
 * Peer-stack e2e for heavygee/hapi#247 (operator feedback) — board item
 * comments: all comments displayed with full detail, a posted comment shows
 * up without a manual refresh, and the issue body/comments scroll
 * underneath the pinned action bar instead of pushing it off-screen.
 *
 * Runs against the public `hapi-demo-board` demo repo only — issue #1
 * ("Replace the lobby carpet tiles") already carries one proof comment from
 * an earlier peer-stack run; this spec adds one more rather than asserting
 * on any real/private board content (this spec ships in a public repo).
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-247 \
 *     e2e/peer/247-board-item-comments.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_COMMENTS = resolve(artifactRoot, 'localdocs/playwright-runs/247-board-item-comments.png')
const PNG_PINNED_ACTIONS = resolve(artifactRoot, 'localdocs/playwright-runs/247-pinned-actions.png')

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
            localStorage.setItem('hapi.fue.v1.boards-mode', '1')
            localStorage.setItem('hapi.onboarding.v1.shell-tour', '1')
        } catch {
            // about:blank
        }
    }, { key: storageKey, token: accessToken })
}

test.describe('board item comments — peer stack (#247)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('shows existing comments with author/body, a posted comment appears without a manual refresh, and the action bar stays pinned while content scrolls', async ({ page }) => {
        mkdirSync(dirname(PNG_COMMENTS), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 900, height: 700 })
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
            await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        }

        const modeSwitch = page.getByRole('radiogroup', { name: 'Switch between sessions and boards view' })
        await expect(modeSwitch).toBeVisible({ timeout: 60_000 })
        await modeSwitch.getByRole('radio', { name: 'Boards' }).click()

        // A freshly provisioned peer stack has zero boards configured (no
        // auto-seed) — add the public demo board (heavygee/6, "HAPI Demo
        // Board") the same way an operator would, via the UI's own dialog.
        // Two elements share the "Add a board" accessible name (the always-
        // present "+" chip and the zero-state explainer's button) — take the
        // first, which is always present regardless of board count.
        await page.getByRole('button', { name: 'Add a board' }).first().click()
        await page.getByPlaceholder('https://github.com/users/<handle>/projects/<n>').fill('https://github.com/users/heavygee/projects/6')
        await page.getByRole('button', { name: 'Add', exact: true }).click()

        const itemList = page.getByTestId('board-item-list')
        await expect(itemList).toBeVisible({ timeout: 30_000 })
        await clickForHuman(itemList.getByText('Replace the lobby carpet tiles'), {
            waitFor: () => page.getByTestId('board-item-detail').waitFor({ state: 'visible', timeout: 15_000 }),
        })

        const detailBody = page.getByTestId('board-item-detail-body')
        const actionsBar = page.getByTestId('board-item-detail-actions')
        await expect(actionsBar).toBeVisible({ timeout: 15_000 })

        // Existing comment from an earlier peer-stack run — proves comments
        // fetch and render with author + body, not just the composer.
        await expect(detailBody.getByText('Automated peer-stack proof comment')).toBeVisible({ timeout: 15_000 })
        await expect(detailBody.getByText('heavygee', { exact: true }).first()).toBeVisible()
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_COMMENTS })

        // Pinned-actions check: record the action bar's position, scroll the
        // body content, confirm the bar did not move (content scrolls
        // underneath it, it does not get pushed down by that content).
        const beforeScroll = await actionsBar.boundingBox()
        await detailBody.evaluate((el) => { el.scrollTop = el.scrollHeight })
        await dwellForHuman(page, 500)
        const afterScroll = await actionsBar.boundingBox()
        expect(beforeScroll).not.toBeNull()
        expect(afterScroll).not.toBeNull()
        expect(afterScroll!.y).toBeCloseTo(beforeScroll!.y, 0)
        await expect(actionsBar.getByRole('button', { name: /Spawn session|Open session/ })).toBeVisible()
        await page.screenshot({ path: PNG_PINNED_ACTIONS })

        // Live-update-on-post check: a freshly posted comment must appear
        // without a manual page refresh.
        const stamp = `peer-stack proof comment ${Date.now()}`
        await page.getByLabel('Comment').fill(stamp)
        await clickForHuman(page.getByRole('button', { name: 'Comment', exact: true }), {
            waitFor: () => detailBody.getByText(stamp).waitFor({ state: 'visible', timeout: 20_000 }),
        })
        await expect(detailBody.getByText(stamp)).toBeVisible()
    })
})
