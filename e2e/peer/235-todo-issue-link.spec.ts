/*
 * Peer-stack e2e for heavygee/hapi#235/#238 — spawning a session from a to-do
 * card auto-links the underlying GitHub issue (metadata.externalRefs) and
 * surfaces an IssueRefChip on both the session detail header and the session
 * row in the sidebar.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-235 \
 *     e2e/peer/235-todo-issue-link.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_HEADER_CHIP = resolve(artifactRoot, 'localdocs/playwright-runs/235-issue-chip-header.png')
const PNG_ROW_CHIP = resolve(artifactRoot, 'localdocs/playwright-runs/235-issue-chip-row.png')

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

test.describe('spawning from a to-do card auto-links the issue — peer stack (#235/#238)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('spawned session gets an IssueRefChip on detail and on its sidebar row', async ({ page }) => {
        mkdirSync(dirname(PNG_HEADER_CHIP), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoTodoMode(page)

        const firstCard = page.getByRole('button').filter({ hasText: /Replace the lobby carpet tiles/ })
        await clickForHuman(firstCard, {
            waitFor: () => page.getByRole('button', { name: /^Spawn session$/ }).waitFor({ state: 'visible', timeout: 15_000 }),
        })

        // Capture the item's own GitHub issue URL so the assertion below
        // checks against the real link, not a hardcoded issue number.
        const openInGithub = page.getByRole('link', { name: 'Open in GitHub', exact: true })
        const issueUrl = await openInGithub.getAttribute('href')
        expect(issueUrl).toMatch(/^https:\/\/github\.com\/.+\/issues\/\d+$/)

        const spawnButton = page.getByRole('button', { name: /^Spawn session$/ })
        await clickForHuman(spawnButton, {
            waitFor: () => page.getByRole('heading', { name: 'New Session' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        })
        await expect(page).toHaveURL(/\/sessions\/new/)

        const directoryInput = page.getByPlaceholder(/directory|path/i).first()
        if (await directoryInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            const currentValue = await directoryInput.inputValue()
            if (!currentValue.trim()) {
                await directoryInput.fill('/work/coding/hapi')
            }
        }
        const createButton = page.getByRole('button', { name: /^(Create|Start|Spawn)/i }).first()
        await clickForHuman(createButton, {
            waitFor: () => page.waitForURL(/\/sessions\/(?!new)/, { timeout: 30_000 }),
        })

        // The chip appears once the fire-and-forget link-issue call lands and
        // the hub pushes the metadata update back over SSE — no manual
        // reload, same live-sync path as a rename or title change. The wide
        // viewport keeps the sidebar and the detail header both on screen at
        // once (split view, with a pinned "in progress" row alongside the
        // regular list), so the chip legitimately renders more than once
        // here — every instance should point at the same linked issue.
        const chips = page.getByTestId('issue-ref-chip')
        await expect(chips.first()).toBeVisible({ timeout: 15_000 })
        const chipCount = await chips.count()
        expect(chipCount).toBeGreaterThan(0)
        for (let i = 0; i < chipCount; i += 1) {
            await expect(chips.nth(i)).toHaveAttribute('href', issueUrl!)
        }
        await dwellForHuman(page, 800)
        await page.screenshot({ path: PNG_HEADER_CHIP })

        // Narrow to a single-pane mobile layout: only the sidebar row chip
        // remains on screen (detail header is off-screen behind the list).
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        const rowChip = page.getByTestId('issue-ref-chip').first()
        await expect(rowChip).toBeVisible({ timeout: 15_000 })
        await expect(rowChip).toHaveAttribute('href', issueUrl!)
        await dwellForHuman(page, 500)
        await page.screenshot({ path: PNG_ROW_CHIP })
    })
})
