/*
 * Peer-stack e2e for tiann/hapi#1506 — @ mention pool excludes path husks / empty stubs.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence tier: PNG of @ dropdown (interaction is typed query → list).
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(
    artifactRoot,
    'localdocs/playwright-runs/1506-session-mention-sidebar-husks.png'
)
const LIVE_TITLE = 'Peer: session-attached jobs'
const QUERY = 'session-attached'

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs --worktree … '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function createSession(metadata: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1506-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: '/tmp/peer1506',
                host: hostname(),
                flavor: 'claude',
                ...metadata,
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

async function gotoSession(page: Page, sessionId: string): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
        localStorage.setItem('hapi.fue.v1.rich-composer-mentions', '1')
        localStorage.setItem('hapi.fue.v1.disabled', '1')
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.getByTestId('rich-composer-input').waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('session mention sidebar husks — peer stack (#1506)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('@ dropdown shows named session and excludes path-only husk', async ({ page }) => {
        const composerSessionId = await createSession({
            path: '/tmp/peer1506-composer',
            name: `Peer1506 Composer ${Date.now()}`,
        })
        await createSession({
            path: '/home/me/coding/hapi/worktrees/session-attached-jobs',
            name: LIVE_TITLE,
        })
        // Path-only husk with agentSessionId — sidebar may show it; @ must not.
        await createSession({
            path: '/home/me/coding/hapi/worktrees/session-attached-jobs',
            agentSessionId: 'agent-husk-1506',
            lifecycleState: 'archived',
        })
        // Classic empty stub (no agent id / title) — sidebar-hidden; @ must not.
        await createSession({
            path: '/home/me/coding/hapi/worktrees/session-attached-jobs',
            lifecycleState: 'archived',
        })

        await gotoSession(page, composerSessionId)

        const composer = page.getByTestId('rich-composer-input')
        await composer.click()
        await page.keyboard.type(`@${QUERY}`, { delay: 40 })

        const liveHit = page.getByRole('button', { name: new RegExp(`@${LIVE_TITLE}`) })
        await expect(liveHit).toBeVisible({ timeout: 15_000 })

        // Path basename must not appear as a mention label.
        await expect(page.getByRole('button', { name: /@session-attached-jobs\b/ })).toHaveCount(0)

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    })
})
