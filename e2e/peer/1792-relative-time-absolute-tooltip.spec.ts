/*
 * Peer-stack e2e for tiann/hapi#1792 — absolute datetime tooltips on relative ages.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence tier: PNG (native `title` tooltips are OS-drawn; assert attribute + sidebar frame).
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
    'localdocs/playwright-runs/1792-relative-time-absolute-tooltip.png'
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
    const updatedAt = Date.now() - 3 * 60 * 60 * 1000
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `peer1792-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: '/tmp/peer1792',
                host: hostname(),
                flavor: 'claude',
                name: 'Peer #1792 age tooltip',
                ...metadata,
            },
            agentState: { requests: {}, completedRequests: {} },
            // Some hubs accept updatedAt on create; if ignored we still get a row age.
            updatedAt,
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

test.describe('relative-time absolute tooltip — peer stack (#1792)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
    })

    test('session row age exposes absolute datetime title', async ({ page }) => {
        const sessionId = await createSession({})
        await gotoSession(page, sessionId)

        const age = page.getByTestId('session-row-age').first()
        await expect(age).toBeVisible({ timeout: 30_000 })
        const title = await age.getAttribute('title')
        expect(title).toBeTruthy()
        // Locale full datetime from formatAbsoluteDateTime / Date#toLocaleString
        expect(title!).toMatch(/\d/)

        // Annotate for still-frame proof (OS native title tooltips do not paint in headless).
        await age.evaluate((el, absolute) => {
            const tip = document.createElement('div')
            tip.setAttribute('data-testid', 'peer-1792-title-overlay')
            tip.textContent = absolute
            tip.style.cssText = [
                'position:fixed',
                'z-index:99999',
                'padding:6px 10px',
                'border-radius:6px',
                'background:#111',
                'color:#f5f5f5',
                'font:12px/1.3 ui-sans-serif,system-ui,sans-serif',
                'box-shadow:0 4px 16px rgba(0,0,0,.45)',
                'pointer-events:none',
            ].join(';')
            const rect = el.getBoundingClientRect()
            tip.style.left = `${Math.max(8, rect.left - 8)}px`
            tip.style.top = `${Math.max(8, rect.bottom + 8)}px`
            document.body.appendChild(tip)
        }, title!)

        await expect(page.getByTestId('peer-1792-title-overlay')).toBeVisible()
        // Prefer element/viewport capture — full page.screenshot can flake under headless CDP.
        await page.locator('.session-list-item').first().screenshot({ path: SCREENSHOT_PATH })
        const fullPath = resolve(
            artifactRoot,
            'localdocs/playwright-runs/1792-relative-time-absolute-tooltip-full.png'
        )
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.screenshot({ path: fullPath })
                break
            } catch {
                await page.waitForTimeout(250)
            }
        }
    })
})
