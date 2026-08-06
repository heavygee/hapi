/*
 * Peer-stack e2e for tiann/hapi#1395 — session header project/path metadata.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Asserts SessionHeader shows the sidebar-style project label (last two path
 * segments) by default, including when a worktree branch is also present.
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1395-session-header-project.png')

const runId = `${Date.now()}`
const TITLE = `Peer1395 Header Project ${runId}`
const PROJECT_PATH = `/home/heavygee/coding/hapi`
const WORKTREE_CHECKOUT = `/tmp/peer1395-wt-${runId}`

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree … '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function createSession(): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1395-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: WORKTREE_CHECKOUT,
                host: hostname(),
                flavor: 'cursor',
                name: TITLE,
                worktree: {
                    basePath: PROJECT_PATH,
                    branch: 'feat/session-header-project-path',
                    name: `peer1395-${runId}`,
                    worktreePath: WORKTREE_CHECKOUT,
                },
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
            // Ensure default-on project field is visible even if a prior run
            // left preferences with project:false in this peer HAPI_HOME.
            localStorage.removeItem('hapi-session-header-metadata')
        } catch {
            // about:blank opaque origin
        }
    }, { key: storageKey, token: accessToken })
}

async function gotoSession(page: Page, sessionId: string): Promise<void> {
    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
        await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
}

test.describe('session header project path — peer stack (#1395)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('header shows sidebar-style project and worktree branch', async ({ page }) => {
        mkdirSync(dirname(PNG_PATH), { recursive: true })
        const sessionId = await createSession()

        await injectAuth(page)
        await gotoSession(page, sessionId)

        await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 60_000 })
        const project = page.getByTestId('session-header-project')
        await expect(project).toBeVisible({ timeout: 30_000 })
        await expect(project).toHaveText(/coding\/hapi/)
        await expect(project).not.toHaveText(/peer1395/)
        await expect(page.getByTestId('session-header-worktree')).toHaveText(/feat\/session-header-project-path/)

        await page.locator('[data-testid="session-header-project"]').screenshot({ path: PNG_PATH })
        const headerShot = resolve(artifactRoot, 'localdocs/playwright-runs/1395-session-header-project-full.png')
        const headerRow = page.getByTestId('session-header-project').locator('xpath=ancestor::div[contains(@class,"max-w-content")][1]')
        await headerRow.screenshot({ path: headerShot })
    })
})
