/*
 * Peer-stack e2e for tiann/hapi#1732 — session-list scrollbar tick for open session.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence tier: PNG (tick visible on left rail while another session is open).
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
    'localdocs/playwright-runs/1732-session-list-open-tick.png'
)

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
            tag: `peer1732-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: '/tmp/peer1732',
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
        localStorage.setItem('hapi.fue.v1.disabled', '1')
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.locator('.session-list-item').first().waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('session-list open-session scrollbar tick — peer stack (#1732)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('shows a rail tick for the open session when the list overflows', async ({ page }) => {
        // Enough rows that the sidebar must scroll on a typical peer viewport.
        const ids: string[] = []
        for (let i = 0; i < 40; i++) {
            ids.push(await createSession({
                path: `/tmp/peer1732/project-${String(i).padStart(2, '0')}`,
                name: `Peer1732 filler ${String(i).padStart(2, '0')}`,
            }))
        }
        const openId = ids[20]!

        await gotoSession(page, openId)

        const tick = page.locator('.session-list-open-tick')
        await expect(tick).toBeVisible({ timeout: 15_000 })
        await expect(tick).toHaveAttribute(
            'title',
            /open session|scrollbar|jump/i,
        )

        const box = await tick.boundingBox()
        expect(box).toBeTruthy()
        expect(box!.width).toBeGreaterThan(0)
        expect(box!.height).toBeGreaterThan(0)

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    })
})
