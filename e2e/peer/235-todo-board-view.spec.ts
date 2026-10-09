/*
 * Peer-stack e2e for heavygee/hapi#235 — to-do board view, first shippable slice:
 * global [Sessions] [To-Do] mode switch, board switcher (one real board —
 * heavygee/6, the dull public demo board, the hub's safe default),
 * status-grouped list, fold-to-bottom for done items.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-235 \
 *     e2e/peer/235-todo-board-view.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_SESSIONS_MODE = resolve(artifactRoot, 'localdocs/playwright-runs/235-sessions-mode.png')
const PNG_TODO_MODE = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-mode.png')
const PNG_DONE_EXPANDED = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-done-expanded.png')

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

test.describe('to-do board view — peer stack (#235)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('mode switch reveals board switcher + status-grouped real board data', async ({ page }) => {
        mkdirSync(dirname(PNG_SESSIONS_MODE), { recursive: true })

        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoSessions(page)

        const modeSwitch = page.getByRole('radiogroup', { name: 'Switch between sessions and to-do view' })
        await expect(modeSwitch).toBeVisible({ timeout: 60_000 })
        await page.screenshot({ path: PNG_SESSIONS_MODE })

        const todoButton = modeSwitch.getByRole('radio', { name: 'To-Do' })
        await clickForHuman(todoButton, {
            waitFor: () => page.getByRole('radiogroup', { name: 'Filter to-do items by board' }).waitFor({ state: 'visible', timeout: 15_000 }),
        })

        const boardSwitcher = page.getByRole('radiogroup', { name: 'Filter to-do items by board' })
        await expect(boardSwitcher).toBeVisible()
        const boardChip = boardSwitcher.getByRole('radio', { name: 'heavygee/6' })
        await expect(boardChip).toBeVisible()
        await expect(boardChip).toHaveAttribute('aria-checked', 'true')

        // Real data from the live board (hapi#235: gh CLI shortcut, no fixtures).
        // Assert structurally (item presence/count via "Open in GitHub" links),
        // never on specific item text — this board carries real personal
        // content and this spec ships in a public repo's permanent git history.
        const githubLinks = page.getByRole('link', { name: /Open in GitHub/i })
        await expect(page.getByText('In Progress (')).toBeVisible({ timeout: 30_000 })
        await expect(githubLinks.first()).toBeVisible({ timeout: 30_000 })
        const countBeforeExpand = await githubLinks.count()
        expect(countBeforeExpand).toBeGreaterThan(0)
        await dwellForHuman(page, 1000)
        await page.screenshot({ path: PNG_TODO_MODE })

        const doneToggle = page.getByRole('button', { name: /^Show \d+ done$/ })
        await expect(doneToggle).toBeVisible()
        await clickForHuman(doneToggle, {
            waitFor: () => page.getByRole('button', { name: /^Hide \d+ done$/ }).waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await expect(async () => {
            expect(await githubLinks.count()).toBeGreaterThan(countBeforeExpand)
        }).toPass({ timeout: 10_000 })
        await dwellForHuman(page, 1200)
        await page.screenshot({ path: PNG_DONE_EXPANDED })

        const openInGithubLink = githubLinks.first()
        await expect(openInGithubLink).toHaveAttribute('target', '_blank')
        await expect(openInGithubLink).toHaveAttribute('href', /github\.com\/heavygee\/hapi-demo-board\/issues\/\d+/)
    })
})
