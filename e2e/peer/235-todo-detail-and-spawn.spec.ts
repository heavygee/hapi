/*
 * Peer-stack e2e for heavygee/hapi#235/#238 — click-to-detail right pane,
 * spawn session reusing the existing new-session flow, and board add/remove
 * management (dialog + confirm-before-destroy).
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-235 \
 *     e2e/peer/235-todo-detail-and-spawn.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_DETAIL = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-detail.png')
const PNG_SPAWN_COMPOSER = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-spawn-composer.png')
const PNG_ADD_BOARD_ERROR = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-add-board-error.png')
const PNG_REMOVE_CONFIRM = resolve(artifactRoot, 'localdocs/playwright-runs/235-todo-remove-confirm.png')

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

test.describe('to-do item detail, spawn, and board management — peer stack (#235/#238)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('click a card opens detail, spawn reuses the new-session flow, board add/remove work', async ({ page }) => {
        mkdirSync(dirname(PNG_DETAIL), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoTodoMode(page)

        // 1) Click a card body opens detail in the right pane (not a GitHub
        // anchor) — structural assertions only, this board carries real
        // personal-adjacent demo content but the title text itself is
        // harmless placeholder copy ("Replace the lobby carpet tiles" etc).
        const firstCard = page.getByRole('button').filter({ hasText: /Replace the lobby carpet tiles/ })
        await clickForHuman(firstCard, {
            waitFor: () => page.getByRole('button', { name: /^Spawn session$/ }).waitFor({ state: 'visible', timeout: 15_000 }),
        })
        await expect(page.getByRole('heading', { name: 'Replace the lobby carpet tiles' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Open in GitHub', exact: true })).toBeVisible()
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_DETAIL })

        // 2) Spawn session reuses the existing /sessions/new flow and seeds
        // the composer via the existing draft mechanism.
        const spawnButton = page.getByRole('button', { name: /^Spawn session$/ })
        await clickForHuman(spawnButton, {
            waitFor: () => page.getByRole('heading', { name: 'New Session' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        })
        await expect(page).toHaveURL(/\/sessions\/new/)
        await dwellForHuman(page, 500)

        // Submit the (possibly-empty-directory, totally normal) new-session
        // form for real, on this throwaway peer-stack runner, then confirm
        // the composer on the resulting session page shows the seeded text.
        const directoryInput = page.getByPlaceholder(/directory|path/i).first()
        if (await directoryInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            const currentValue = await directoryInput.inputValue()
            if (!currentValue.trim()) {
                // Same directory the peer stack's own seeded Playwright
                // session already uses — guaranteed inside this runner's
                // workspace roots, unlike an arbitrary path such as /tmp.
                await directoryInput.fill('/work/coding/hapi')
            }
        }
        const createButton = page.getByRole('button', { name: /^(Create|Start|Spawn)/i }).first()
        await clickForHuman(createButton, {
            waitFor: () => page.waitForURL(/\/sessions\/(?!new)/, { timeout: 30_000 }),
        })
        const composer = page.getByRole('textbox').first()
        await expect(composer).toContainText('Replace the lobby carpet tiles', { timeout: 15_000 })
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_SPAWN_COMPOSER })

        // 3) Board management: "+" opens the add dialog; an invalid URL shows
        // a clean error (the hub's crafted message, not a raw HTTP string).
        await gotoTodoMode(page)
        const addButton = page.getByRole('button', { name: 'Add a board' })
        await clickForHuman(addButton, {
            waitFor: () => page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await page.getByPlaceholder(/github.com/i).fill('not a project url')
        await clickForHuman(page.getByRole('button', { name: 'Add' }), {
            waitFor: () => page.getByText(/Could not parse a GitHub Projects URL/i).waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_ADD_BOARD_ERROR })
        await page.getByRole('button', { name: 'Cancel' }).click()

        // 4) Remove shows a destructive confirm step before anything happens.
        const removeButton = page.getByRole('button', { name: /Remove heavygee\/6/i })
        await clickForHuman(removeButton, {
            waitFor: () => page.getByRole('heading', { name: 'Remove board' }).waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await expect(page.getByText(/Remove "heavygee\/6" from your board list/)).toBeVisible()
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_REMOVE_CONFIRM })
        // Cancel rather than confirm — removing the only board re-seeds the
        // same default (safety invariant, already covered by hub unit
        // tests); cancelling here keeps this spec non-destructive to repeat.
        await page.getByRole('button', { name: 'Cancel' }).click()
        await expect(page.getByRole('heading', { name: 'Remove board' })).not.toBeVisible()
    })
})
