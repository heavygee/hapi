/*
 * Peer-stack e2e for heavygee/hapi#247 (operator feedback) — "create issue"
 * (New Card) ported from tiann/hapi#2147 into #238's simpler Boards slice:
 * repo -> template -> form -> review wizard, backed by the repo's own real
 * `.github/ISSUE_TEMPLATE/` form.
 *
 * Runs against the public `hapi-demo-board` demo repo only, which already
 * carries a real issue-form template (`facilities-request.yml`,
 * blank_issues_enabled: false) set up specifically to dogfood this feature.
 * This spec creates one real, safe, dull issue in that repo each run — same
 * "dull public demo content" discipline as the existing proof comment.
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/todo-board-ui-worktrees/1009-14eb \
 *     --name todo-board-247-create \
 *     e2e/peer/247-board-create-issue.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { clickForHuman, dwellForHuman } from '../../scripts/dev/playwright-annotated-video.mjs'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_TEMPLATE_PICKER = resolve(artifactRoot, 'localdocs/playwright-runs/247-new-card-template-picker.png')
const PNG_REVIEW = resolve(artifactRoot, 'localdocs/playwright-runs/247-new-card-review.png')
const PNG_CREATED = resolve(artifactRoot, 'localdocs/playwright-runs/247-new-card-created.png')

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

test.describe('board "create issue" / New Card — peer stack (#247)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('creates a real issue from the repo\'s own issue-form template, end to end', async ({ page }) => {
        mkdirSync(dirname(PNG_TEMPLATE_PICKER), { recursive: true })
        await injectAuth(page)
        await page.setViewportSize({ width: 900, height: 800 })
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

        // Fresh peer stack has no boards configured — add the public demo
        // board the same way an operator would.
        await page.getByRole('button', { name: 'Add a board' }).first().click()
        await page.getByPlaceholder('https://github.com/users/<handle>/projects/<n>').fill('https://github.com/users/heavygee/projects/6')
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(page.getByTestId('board-item-list')).toBeVisible({ timeout: 30_000 })

        await clickForHuman(page.getByRole('button', { name: 'New card' }))

        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible({ timeout: 10_000 })

        // Step 1: repo. heavygee/hapi-demo-board is already a known repo on
        // this board (issue #1 lives there), so it's a select option, not
        // free text.
        await dialog.getByRole('combobox').selectOption('heavygee/hapi-demo-board')
        await clickForHuman(dialog.getByRole('button', { name: 'Next' }), {
            waitFor: () => dialog.getByText('Facilities request').waitFor({ state: 'visible', timeout: 20_000 }),
        })
        await page.screenshot({ path: PNG_TEMPLATE_PICKER })

        // Step 2: template pick — the repo's real facilities-request.yml form.
        await clickForHuman(dialog.getByText('Facilities request'))

        // Step 3: form. IssueFormFieldView renders each field's <label> as a
        // sibling of its <input>/<textarea> (no htmlFor/id), so getByLabel
        // won't resolve them — placeholder text (verbatim from the real
        // template) is the reliable selector instead. The urgency dropdown
        // is left untouched: its `default: 0` already seeds an answer via
        // initialAnswersForFields, so it's "answered" without interaction.
        const stamp = Date.now()
        await dialog.getByRole('textbox').first().fill(`[Facilities]: Automated peer-stack proof issue ${stamp}`)
        await dialog.getByPlaceholder('e.g. 2nd floor kitchenette').fill('2nd floor kitchenette (automated proof)')
        await dialog.getByPlaceholder(/The carpet tiles by the lobby door/).fill(`Automated peer-stack proof issue — hapi#247 create-issue round, ${stamp}. Nothing to actually fix, this is dull test content.`)
        await dialog.getByText('I checked this hasn\'t already been reported').click()
        await dwellForHuman(page, 500)

        await clickForHuman(dialog.getByRole('button', { name: 'Next' }), {
            waitFor: () => dialog.getByText('Issue body preview').waitFor({ state: 'visible', timeout: 10_000 }),
        })
        await page.screenshot({ path: PNG_REVIEW })

        // Step 4: review + submit — a real `gh issue create` against the
        // real repo, then added to the real project. A successful submit
        // closes the dialog and returns to the board list.
        await clickForHuman(dialog.getByRole('button', { name: 'Create issue' }), {
            waitFor: () => dialog.waitFor({ state: 'hidden', timeout: 30_000 }),
        })

        // GitHub Projects v2 has a real propagation lag between `gh project
        // item-add` succeeding and that item actually showing up in a
        // subsequent items query — confirmed by hand (item missing on the
        // immediate post-create fetch, present a few seconds + one manual
        // refresh later). Poll with the UI's own Refresh button rather than
        // a single-shot wait.
        const newItem = page.getByTestId('board-item-list').getByText(`Automated peer-stack proof issue ${stamp}`)
        await expect(async () => {
            if (await newItem.isVisible().catch(() => false)) return
            await page.getByRole('button', { name: 'Refresh' }).click()
            await dwellForHuman(page, 2000)
            await expect(newItem).toBeVisible({ timeout: 2000 })
        }).toPass({ timeout: 60_000, intervals: [3000] })
        await page.screenshot({ path: PNG_CREATED })
    })
})
