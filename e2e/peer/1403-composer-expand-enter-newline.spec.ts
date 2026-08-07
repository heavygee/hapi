/*
 * Peer-stack e2e for tiann/hapi#1403 — expanded composer: Enter = newline.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence tier: PNG keyframe (+ peer video when HAPI_PEER_RECORD_VIDEO=1) —
 * expand → type → Enter inserts second line without sending.
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const PNG_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1403-composer-expand-enter-newline.png')

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
            tag: `peer1403-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadata: {
                path: '/tmp/peer1403-composer-expand',
                host: hostname(),
                flavor: 'claude',
                name: `Peer1403 Expand Enter ${Date.now()}`,
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
        try {
            localStorage.setItem(key, token)
            // Force Enter=send (default) and plain-text composer so Enter newline
            // is observable via textarea value (not rich contenteditable).
            localStorage.removeItem('hapi-composer-enter-behavior')
            localStorage.setItem('hapi.composer.richMentions', '0')
        } catch {
            // about:blank opaque origin
        }
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.getByTestId('composer-shell').waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('expanded composer Enter = newline — peer stack (#1403)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('plain Enter inserts newline while expanded; does not clear draft', async ({ page }) => {
        const sessionId = await createSession()
        await gotoSession(page, sessionId)

        await page.getByRole('button', { name: 'Expand message editor' }).click()
        await expect(page.getByTestId('composer-shell')).toHaveAttribute('data-expanded', 'true')

        const composer = page.getByRole('textbox')
        await composer.click()
        await composer.fill('line one')
        await composer.press('Enter')
        await composer.pressSequentially('line two')

        await expect(composer).toHaveValue('line one\nline two')
        await expect(page.getByTestId('composer-shell')).toHaveAttribute('data-expanded', 'true')

        mkdirSync(dirname(PNG_PATH), { recursive: true })
        await page.screenshot({ path: PNG_PATH, fullPage: false })
    })
})
