/*
 * Peer-stack e2e for heavygee/hapi#238 (operator mic correction, lockhouse
 * setup#257) — board item detail can now edit an issue/PR's own title and
 * description, not just comment on it.
 *
 * Runs against the public `hapi-demo-board` demo repo only (issue #1,
 * "Replace the lobby carpet tiles") — reads the item's real current
 * title/body at runtime and restores both at the end, so this spec leaves
 * no lasting change on the shared public demo content (same "dull public
 * demo, no permanent disruption" discipline 247-board-item-comments.spec.ts
 * already follows for comments, extended here to a round-trip restore
 * since title/body are more visible than an appended comment).
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-257-edit \
 *     e2e/peer/257-board-item-edit.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_TITLE_EDIT = resolve(artifactRoot, 'localdocs/playwright-runs/257-board-item-title-edit.png')
const PNG_BODY_EDIT = resolve(artifactRoot, 'localdocs/playwright-runs/257-board-item-body-edit.png')

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

test.describe('board item title/description edit — peer stack (hapi#238, lockhouse setup#257)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('edits the title and description from the detail pane, then restores both', async ({ page }) => {
        mkdirSync(dirname(PNG_TITLE_EDIT), { recursive: true })
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

        // A freshly provisioned peer stack has zero boards configured — add
        // the public demo board the same way an operator would.
        await page.getByRole('button', { name: 'Add a board' }).first().click()
        await page.getByPlaceholder('https://github.com/users/<handle>/projects/<n>').fill('https://github.com/users/heavygee/projects/6')
        await page.getByRole('button', { name: 'Add', exact: true }).click()

        const itemList = page.getByTestId('board-item-list')
        await expect(itemList).toBeVisible({ timeout: 30_000 })
        await clickForHuman(itemList.getByText('Replace the lobby carpet tiles'), {
            waitFor: () => page.getByTestId('board-item-detail').waitFor({ state: 'visible', timeout: 15_000 }),
        })

        const detail = page.getByTestId('board-item-detail')
        const detailBody = page.getByTestId('board-item-detail-body')

        // --- Title edit, round-tripped ---
        const editTitleButton = detail.getByRole('button', { name: 'Edit title' })
        await expect(editTitleButton).toBeVisible({ timeout: 15_000 })
        const titleInput = detail.getByRole('textbox', { name: 'Edit title' })
        await clickForHuman(editTitleButton, { waitFor: () => titleInput.waitFor({ state: 'visible', timeout: 5_000 }) })
        const originalTitle = await titleInput.inputValue()
        const stampedTitle = `${originalTitle} (peer-stack proof ${Date.now()})`
        await titleInput.fill(stampedTitle)
        await dwellForHuman(page, 500)
        await page.screenshot({ path: PNG_TITLE_EDIT })
        // This demo item also carries a GitHub Projects custom field literally
        // named "Title" (renders its own chip with the same text) — scope to
        // the heading role to disambiguate from that chip.
        const titleHeading = detail.getByRole('heading', { name: stampedTitle })
        await clickForHuman(detail.getByRole('button', { name: 'Save' }), {
            waitFor: () => titleHeading.waitFor({ state: 'visible', timeout: 20_000 }),
        })
        await expect(titleHeading).toBeVisible()

        // Restore — leaves no lasting change on the shared public demo item.
        await detail.getByRole('button', { name: 'Edit title' }).click()
        await detail.getByRole('textbox', { name: 'Edit title' }).fill(originalTitle)
        const originalTitleHeading = detail.getByRole('heading', { name: originalTitle, exact: true })
        await clickForHuman(detail.getByRole('button', { name: 'Save' }), {
            waitFor: () => originalTitleHeading.waitFor({ state: 'visible', timeout: 20_000 }),
        })
        await expect(originalTitleHeading).toBeVisible()

        // --- Description edit, round-tripped ---
        const editBodyButton = detail.getByRole('button', { name: 'Edit description' })
        await expect(editBodyButton).toBeVisible()
        const bodyTextarea = detail.getByRole('textbox', { name: 'Edit description' })
        await clickForHuman(editBodyButton, { waitFor: () => bodyTextarea.waitFor({ state: 'visible', timeout: 5_000 }) })
        const originalBody = await bodyTextarea.inputValue()
        const stampedBody = `${originalBody}\n\n_peer-stack proof edit ${Date.now()}_`
        await bodyTextarea.fill(stampedBody)
        await dwellForHuman(page, 500)
        await page.screenshot({ path: PNG_BODY_EDIT })
        await clickForHuman(detail.getByRole('button', { name: 'Save' }), {
            waitFor: () => detailBody.getByText('peer-stack proof edit').waitFor({ state: 'visible', timeout: 20_000 }),
        })
        await expect(detailBody.getByText('peer-stack proof edit')).toBeVisible()

        // Restore.
        await detail.getByRole('button', { name: 'Edit description' }).click()
        await detail.getByRole('textbox', { name: 'Edit description' }).fill(originalBody)
        await clickForHuman(detail.getByRole('button', { name: 'Save' }), {
            waitFor: () => expect(detailBody.getByText('peer-stack proof edit')).toHaveCount(0),
        })
        await expect(detailBody.getByText('peer-stack proof edit')).not.toBeVisible()
    })
})
