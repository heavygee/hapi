/*
 * Peer-stack e2e for heavygee/hapi#121 — operator-hold chip pulse.
 * Fork main only. Product web lives on driver/operator-hold-chip (awareness ancestry).
 *
 *   cd ~/coding/hapi && HAPI_PEER_RECORD_VIDEO=1 node scripts/dev/run-e2e-on-peer-stack.mjs \
 *     --worktree ~/coding/hapi/worktrees/operator-hold-chip-ui \
 *     --name operator-hold-chip \
 *     /home/heavygee/coding/hapi/worktrees/operator-hold-chip/e2e/peer/121-operator-hold-chip.spec.ts
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = process.env.HAPI_MIRROR ?? resolve(process.cwd())

const PNG_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/121-operator-hold-chip.png')
const PNG_HOVER = resolve(artifactRoot, 'localdocs/playwright-runs/121-operator-hold-chip-hover.png')

const runId = `${Date.now()}`
const TITLE = `Peer121 Hold Chip ${runId}`
const HOLD_ACTION = 'HOLD @tiann: please trim this PR'

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree operator-hold-chip-ui'
        )
    }
}

async function authHeaders(): Promise<Record<string, string>> {
    const auth = await fetch(`${hubUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    })
    if (auth.ok) {
        const body = await auth.json() as { token?: string }
        if (body.token) {
            return { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' }
        }
    }
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

async function enableGithubPrAwareness(): Promise<void> {
    const headers = await authHeaders()
    const res = await fetch(`${hubUrl}/api/features`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ githubPrAwareness: true }),
    })
    if (!res.ok) {
        throw new Error(`PATCH /api/features failed (${res.status}): ${await res.text()}`)
    }
}

async function createHoldSession(): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer121-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: `/tmp/peer121-hold-${runId}`,
                host: hostname(),
                flavor: 'cursor',
                name: TITLE,
                externalRefs: [{
                    kind: 'github_pr',
                    repo: 'heavygee/hapi',
                    number: 124,
                    url: 'https://github.com/heavygee/hapi/pull/124',
                    role: 'primary',
                    source: 'agent',
                    status: 'needs_operator',
                    statusCheckedAt: Date.now(),
                    statusAction: HOLD_ACTION,
                }],
            },
            agentState: { requests: {}, completedRequests: {} },
        }),
    })
    if (!res.ok) {
        throw new Error(`POST /cli/sessions failed (${res.status}): ${await res.text()}`)
    }
    const data = await res.json() as { session?: { id?: string } }
    const sessionId = data.session?.id
    if (!sessionId) {
        throw new Error(`unexpected /cli/sessions response: ${JSON.stringify(data)}`)
    }
    return sessionId
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

test.describe('operator-hold chip pulse — peer stack (#121)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('session list chip shows 🛑 pulse and hold tooltip', async ({ page }) => {
        mkdirSync(dirname(PNG_PATH), { recursive: true })
        await enableGithubPrAwareness()
        await createHoldSession()

        const { clickForHuman, dwellForHuman } = await import(
            resolve(mirrorRoot, 'scripts/dev/playwright-annotated-video.mjs')
        ) as {
            clickForHuman: (locator: import('@playwright/test').Locator, options?: {
                waitFor?: () => Promise<unknown>
                dwellMs?: number
            }) => Promise<void>
            dwellForHuman: (page: Page, ms?: number) => Promise<void>
        }

        await injectAuth(page)
        await page.setViewportSize({ width: 1280, height: 900 })
        await gotoSessions(page)

        const openSearch = page.getByRole('button', { name: 'Search sessions' })
        await expect(openSearch).toBeVisible({ timeout: 60_000 })
        await clickForHuman(openSearch, {
            waitFor: () => page.getByPlaceholder(/search/i).waitFor({ state: 'visible', timeout: 15_000 }),
        })
        await page.getByPlaceholder(/search/i).fill(TITLE)

        const chip = page.getByTestId('session-pr-chip').first()
        await expect(chip).toBeVisible({ timeout: 30_000 })
        await expect(chip).toHaveAttribute('data-pr-hold', '1')
        await expect(chip).toHaveAttribute('data-pr-status', 'needs_operator')
        await expect(chip).toHaveText('🛑')
        await expect(chip.getByLabel('operator hold')).toBeVisible()

        await chip.scrollIntoViewIfNeeded()
        await chip.screenshot({ path: PNG_PATH })
        await dwellForHuman(page, 1000)

        await chip.hover()
        await expect(page.getByText(/needs_operator/)).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText(/HOLD @tiann/)).toBeVisible()
        await dwellForHuman(page, 1200)
        await page.screenshot({ path: PNG_HOVER, fullPage: false })
    })
})
