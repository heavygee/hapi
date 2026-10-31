/*
 * Peer-stack e2e for heavygee/hapi#238 — "New card" dialog proof shots.
 *
 * Two states, per the operator's explicit screenshot ask: the template
 * picker (driven by a repo's real .github/ISSUE_TEMPLATE/ forms — the
 * "HAPI Demo Board" project points at heavygee/hapi-demo-board, a public
 * repo deliberately set up with a facilities-request.yml form and
 * blank_issues_enabled: false for this purpose) and the blocked state
 * (blank issues disabled, nothing usable parsed — a combination rare
 * enough in the wild that this screenshot exercises the real UI against a
 * synthetic `issue-templates` response rather than hunting for a public
 * repo with exactly that config).
 *
 *   cd ~/coding/hapi && node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/boards-and-pr-awareness \
 *     --name boards-238-newcard \
 *     e2e/peer/238-newcard-template-and-block.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_TEMPLATE_PICKER = resolve(artifactRoot, 'localdocs/playwright-runs/238-newcard-template-picker.png')
const PNG_BLOCKED = resolve(artifactRoot, 'localdocs/playwright-runs/238-newcard-blocked.png')

async function loginAndOpenBoard(page: import('@playwright/test').Page) {
    if (!hubUrl || !accessToken) {
        throw new Error('Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree boards-and-pr-awareness')
    }
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
    const modeSwitch = page.getByRole('radiogroup', { name: 'Switch between sessions and boards view' })
    await expect(modeSwitch).toBeVisible({ timeout: 60_000 })
    await modeSwitch.getByRole('radio', { name: /Boards/ }).click()
    await expect(page.getByText('In Progress (')).toBeVisible({ timeout: 30_000 })
}

test.describe('New card dialog — peer stack (#238)', () => {
    test('template picker shows the repo\'s real issue-form template, with blank hidden (blank_issues_enabled: false)', async ({ page }) => {
        mkdirSync(dirname(PNG_TEMPLATE_PICKER), { recursive: true })
        await loginAndOpenBoard(page)

        await page.getByRole('button', { name: 'New card' }).click()
        // heavygee/hapi-demo-board is already "seen on the board" (it has
        // items on it), so the repo step offers it in the convenience
        // dropdown rather than starting on free text.
        await page.getByRole('combobox').selectOption('heavygee/hapi-demo-board')
        await page.getByRole('button', { name: 'Next' }).click()

        await expect(page.getByText('Facilities request')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Report a facilities issue or request something for the office')).toBeVisible()
        // blank_issues_enabled: false on this repo — no "Open a blank issue" entry.
        await expect(page.getByText('Open a blank issue')).toHaveCount(0)
        await page.screenshot({ path: PNG_TEMPLATE_PICKER })
    })

    test('blocked state: blank disabled and nothing usable parsed — reasons listed, GitHub chooser offered', async ({ page }) => {
        mkdirSync(dirname(PNG_BLOCKED), { recursive: true })
        await loginAndOpenBoard(page)

        // Synthetic fixture: a repo with blank_issues_enabled: false whose only
        // template uses a form element this parser does not support — a
        // combination public repos rarely hit in practice, so this exercises
        // the real NewCardDialog component against a crafted hub response
        // rather than a live repo.
        await page.route('**/api/todo-boards/*/issue-templates*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    templates: [{
                        id: 'legacy-intake.yml',
                        name: 'Legacy intake form',
                        kind: 'unsupported',
                        reason: 'Uses a multi-select-with-custom-values field this picker does not support yet'
                    }],
                    blankAllowed: false,
                    githubNewIssueUrl: 'https://github.com/example/legacy-tracker/issues/new/choose'
                })
            })
        })

        await page.getByRole('button', { name: 'New card' }).click()
        // example/legacy-tracker isn't a repo seen on this board, so switch
        // the convenience dropdown to free text first.
        await page.getByRole('combobox').selectOption('__other__')
        await page.getByPlaceholder('owner/repo').fill('example/legacy-tracker')
        await page.getByRole('button', { name: 'Next' }).click()

        await expect(page.getByText('This repository does not accept blank issues.')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Legacy intake form')).toBeVisible()
        await expect(page.getByText('Uses a multi-select-with-custom-values field this picker does not support yet')).toBeVisible()
        await expect(page.getByRole('link', { name: 'Open on GitHub instead' })).toHaveAttribute(
            'href', 'https://github.com/example/legacy-tracker/issues/new/choose'
        )
        await page.screenshot({ path: PNG_BLOCKED })
    })
})
