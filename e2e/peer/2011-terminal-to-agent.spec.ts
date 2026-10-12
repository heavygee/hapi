/*
 * Peer-stack e2e for tiann/hapi#2011 — terminal To agent / Selection to agent.
 * Run via scripts/dev/run-e2e-on-peer-stack.mjs from the mirror with
 * --worktree ~/coding/hapi/worktrees/terminal-to-agent.
 */

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run via run-e2e-on-peer-stack.mjs with a seeded session '
            + 'or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function primeAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })
}

test.describe('terminal to agent — peer stack (#2011)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('shows To agent on the terminal control bar', async ({ page }) => {
        // Evidence tier: PNG — control presence (selection flip covered by unit tests).
        await page.setViewportSize({ width: 1280, height: 900 })
        await primeAuth(page)
        await page.goto(`/sessions/${sessionId}/terminal`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        const login = page.getByPlaceholder('Access token')
        if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
            await login.fill(accessToken)
            await page.getByRole('button', { name: /sign in|login|connect/i }).click()
            await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
            await page.goto(`/sessions/${sessionId}/terminal`, {
                waitUntil: 'domcontentloaded',
                timeout: 60_000,
            })
        }

        const toAgent = page.getByTestId('terminal-to-agent')
        await toAgent.waitFor({ state: 'visible', timeout: 60_000 })
        await expect(toAgent).toHaveText('To agent')

        mkdirSync(resolve(artifactRoot, 'localdocs/playwright-runs'), { recursive: true })
        const shotPath = resolve(artifactRoot, 'localdocs/playwright-runs/2011-terminal-to-agent.png')
        await page.screenshot({ path: shotPath, fullPage: false })
    })
})
