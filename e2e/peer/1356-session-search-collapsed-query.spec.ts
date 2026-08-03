/*
 * Peer-stack e2e for tiann/hapi#1356 — collapsed session search shows truncated query.
 * Fork main only — run via run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1356-session-search-collapsed-query.png')
const QUERY = 'jellybot'

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run hapi-peer-stack up then export vars from localdocs/peer-stack.env '
            + 'or use scripts/dev/run-e2e-on-peer-stack.mjs from fork main.'
        )
    }
}

async function createSession(title: string, path: string): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1356-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path,
                host: hostname(),
                flavor: 'cursor',
                name: title,
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
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })
}

test.describe('collapsed session search query — peer stack (#1356)', () => {
    test.beforeAll(() => {
        requirePeerEnv()
    })

    test('collapsed control shows truncated query text, not only a dot', async ({ page }) => {
        const runId = Date.now()
        const matchTitle = `jellybot peer1356 ${runId}`
        const otherTitle = `other peer1356 ${runId}`
        await createSession(matchTitle, `/tmp/peer1356-match-${runId}`)
        await createSession(otherTitle, `/tmp/peer1356-other-${runId}`)

        await injectAuth(page)
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const openSearch = page.getByRole('button', { name: 'Search sessions' })
        await expect(openSearch).toBeVisible({ timeout: 60_000 })
        await openSearch.click()

        const input = page.getByPlaceholder('Search sessions…')
        await expect(input).toBeVisible({ timeout: 15_000 })
        await input.fill(QUERY)
        await expect(page.getByRole('button', { name: new RegExp(matchTitle) })).toBeVisible({ timeout: 15_000 })
        await expect(page.getByRole('button', { name: new RegExp(otherTitle) })).toHaveCount(0)

        // Collapse via blur (click outside the search wrapper).
        await page.locator('body').click({ position: { x: 8, y: 8 } })
        await expect(input).toHaveCount(0)

        const collapsed = page.getByRole('button', { name: new RegExp(`Search sessions:\\s*${QUERY}`) })
        await expect(collapsed).toBeVisible({ timeout: 10_000 })
        await expect(collapsed).toContainText(QUERY)

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await collapsed.screenshot({ path: SCREENSHOT_PATH })
        // Also capture the full sidebar header row for operator proof.
        const toolbar = collapsed.locator('xpath=ancestor::div[contains(@class,"flex") and contains(@class,"items-center")][1]')
        await toolbar.screenshot({
            path: resolve(artifactRoot, 'localdocs/playwright-runs/1356-session-search-collapsed-header.png'),
        })
    })
})
