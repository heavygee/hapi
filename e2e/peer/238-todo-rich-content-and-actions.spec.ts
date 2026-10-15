/*
 * Peer-stack e2e for heavygee/hapi#238 — richer card/detail content
 * (assignees, labels, custom project fields, timestamps), manual refresh
 * (list + detail), and the first write-capable actions (comment,
 * status-change, close/reopen) against the public demo board.
 *
 * Issue #1 on heavygee/hapi-demo-board was deliberately enriched with a
 * "bug" label, the "heavygee" assignee, and a custom "Priority" project
 * field (set to "High") so this spec has real data to assert against — that
 * demo board exists specifically to be poked at like this.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-238 \
 *     e2e/peer/238-todo-rich-content-and-actions.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_CARD_CONTENT = resolve(artifactRoot, 'localdocs/playwright-runs/238-todo-card-content.png')
const PNG_DETAIL_CONTENT = resolve(artifactRoot, 'localdocs/playwright-runs/238-todo-detail-content.png')
const PNG_WRITE_ACTIONS = resolve(artifactRoot, 'localdocs/playwright-runs/238-todo-write-actions.png')

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

test.describe('to-do rich content, refresh, and write actions — peer stack (#238)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('card shows labels/assignees, detail shows full metadata, writes round-trip against the demo board', async ({ page }) => {
        mkdirSync(dirname(PNG_CARD_CONTENT), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoTodoMode(page)

        // 1) Card-level glance content — the operator's framing for this
        // round: "the whole reason to bring these cards here is to not have
        // to go to GitHub" — labels and assignee avatars must be visible
        // without opening the item.
        const itemList = page.getByTestId('todo-item-list')
        const firstCard = itemList.getByRole('button').filter({ hasText: /Replace the lobby carpet tiles/ })
        await expect(firstCard.getByText('bug')).toBeVisible()
        await expect(firstCard.getByTitle('heavygee')).toBeVisible()
        await dwellForHuman(page, 500)
        await page.screenshot({ path: PNG_CARD_CONTENT })

        // 2) List-view refresh button — new in this round (previously only
        // the detail pane had one).
        const listRefresh = page.getByRole('button', { name: 'Refresh' }).first()
        await clickForHuman(listRefresh, { waitFor: () => dwellForHuman(page, 300) })

        // 3) Open the item, assert the richer detail content this round adds:
        // assignee, label, the generic custom "Priority" field, and the
        // created/updated timestamp rows.
        await clickForHuman(firstCard, {
            waitFor: () => page.getByRole('button', { name: /^Spawn session$/ }).waitFor({ state: 'visible', timeout: 15_000 }),
        })
        const detail = page.getByTestId('todo-item-detail')
        await expect(page.getByRole('heading', { name: 'Replace the lobby carpet tiles' })).toBeVisible()
        await expect(detail.getByText('heavygee', { exact: true })).toBeVisible()
        await expect(detail.getByText('bug')).toBeVisible()
        await expect(detail.getByText('Priority')).toBeVisible()
        await expect(detail.getByText('High')).toBeVisible()
        await expect(detail.getByText('Created:')).toBeVisible()
        await expect(detail.getByText('Updated:')).toBeVisible()
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_DETAIL_CONTENT })

        // 4) Detail-pane refresh button.
        const detailRefresh = detail.getByRole('button', { name: 'Refresh' })
        await clickForHuman(detailRefresh, { waitFor: () => dwellForHuman(page, 300) })

        // 5) Write action: post a comment, verify it round-trips through a
        // real `gh issue comment` call against the public demo repo and the
        // draft clears on success.
        const commentBox = detail.getByPlaceholder('Leave a comment…')
        await commentBox.fill('Automated peer-stack proof comment — hapi#238 write-action round.')
        await clickForHuman(detail.getByRole('button', { name: 'Comment', exact: true }), {
            waitFor: () => expect(commentBox).toHaveValue('', { timeout: 15_000 }),
        })

        // 6) Write action: status change round-trip (In Progress -> Todo ->
        // back to In Progress), leaving the demo board exactly as found.
        const statusSelect = detail.getByLabel(/Status/)
        await expect(statusSelect).toHaveValue('In Progress')
        await statusSelect.selectOption('Todo')
        await expect(statusSelect).toHaveValue('Todo', { timeout: 15_000 })
        await dwellForHuman(page, 500)
        await statusSelect.selectOption('In Progress')
        await expect(statusSelect).toHaveValue('In Progress', { timeout: 15_000 })

        // 7) Write action: close then reopen round-trip (the one
        // destructive-feeling action, hence the confirm step) — leaves the
        // demo issue open exactly as found.
        await clickForHuman(detail.getByRole('button', { name: 'Close', exact: true }), {
            waitFor: () => page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 }),
        })
        const dialog = page.getByRole('dialog')
        await dwellForHuman(page, 500)
        await page.screenshot({ path: PNG_WRITE_ACTIONS })
        // The dialog's own "x" dismiss button shares the accessible name
        // "Close" with the confirm action button — the confirm button
        // renders first in DOM order (see TodoItemDetail.test.tsx).
        await clickForHuman(dialog.getByRole('button', { name: 'Close', exact: true }).first(), {
            waitFor: () => detail.getByRole('button', { name: 'Reopen', exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
        })
        await clickForHuman(detail.getByRole('button', { name: 'Reopen', exact: true }), {
            waitFor: () => detail.getByRole('button', { name: 'Close', exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
        })
    })
})
