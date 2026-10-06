/*
 * Peer-stack e2e for tiann/hapi#1235 — scratchlist text (+ attachment metadata)
 * included in session export JSON / Markdown.
 * Fork main only — run via scripts/dev/run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 *
 * Evidence: PNG of Export dialog (locale copy mentions scratchlist) + JSON download asserts.
 * Tier 4b: static existence / payload proof; no motion story.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1235-scratchlist-export-peer.png')
const NOTE_TEXT = 'Peer #1235 scratchlist note for export'

function requirePeerEnv(): void {
    if (!hubUrl || !sessionId || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run: node scripts/dev/run-e2e-on-peer-stack.mjs '
            + '--worktree … or export HAPI_PEER_WEB_URL, HAPI_PEER_SESSION_ID, HAPI_PEER_CLI_TOKEN'
        )
    }
}

async function webJwt(): Promise<string> {
    const res = await fetch(`${hubUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    })
    if (!res.ok) {
        throw new Error(`POST /api/auth failed: ${res.status} ${await res.text()}`)
    }
    const body = await res.json() as { token?: string }
    if (!body.token) {
        throw new Error(`POST /api/auth missing token: ${JSON.stringify(body)}`)
    }
    return body.token
}

async function seedScratchlistNote(): Promise<void> {
    const jwt = await webJwt()
    const res = await fetch(`${hubUrl}/api/sessions/${sessionId}/scratchlist`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: NOTE_TEXT }),
    })
    if (!res.ok) {
        throw new Error(`Failed to seed scratchlist: ${res.status} ${await res.text()}`)
    }
}

async function gotoRealSession(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })

    await page.goto(`/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 3000 }).catch(() => false)) {
        await login.fill(accessToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    await page.getByRole('button', { name: 'Scratchlist drawer' }).waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('scratchlist in session export — peer stack (#1235)', () => {
    test.beforeEach(() => {
        requirePeerEnv()
    })

    test('export JSON includes scratchlist notes; dialog copy mentions scratchlist', async ({ page }) => {
        await seedScratchlistNote()

        const jwt = await webJwt()
        const apiExport = await fetch(`${hubUrl}/api/sessions/${sessionId}/export`, {
            headers: { Authorization: `Bearer ${jwt}` },
        })
        expect(apiExport.status).toBe(200)
        const payload = await apiExport.json() as {
            schemaVersion: number
            scratchlist: Array<{ text: string; attachments?: unknown[] }>
        }
        expect(payload.schemaVersion).toBe(2)
        expect(payload.scratchlist.some((entry) => entry.text === NOTE_TEXT)).toBe(true)

        await gotoRealSession(page)

        // Session header ⋯ button: title="More" / session.more, aria-haspopup="menu"
        await page.locator('button[aria-haspopup="menu"]').first().click()
        await page.getByRole('menuitem', { name: 'Export conversation' }).click()
        await expect(page.getByRole('heading', { name: 'Export conversation' })).toBeVisible()
        await expect(page.getByText(/download the full visible conversation and scratchlist notes/i)).toBeVisible()
        await expect(page.getByText(/scratchlist notes \(attachment metadata only\)/i)).toBeVisible()

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

        const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
        await page.getByRole('button', { name: 'Download' }).click()
        const download = await downloadPromise
        expect(download.suggestedFilename()).toMatch(/\.json$/)

        const downloadPath = resolve(artifactRoot, 'localdocs/playwright-runs/1235-export-download.json')
        await download.saveAs(downloadPath)
        const downloaded = JSON.parse(readFileSync(downloadPath, 'utf-8')) as {
            schemaVersion: number
            scratchlist: Array<{ text: string }>
        }
        expect(downloaded.schemaVersion).toBe(2)
        expect(downloaded.scratchlist.some((entry) => entry.text === NOTE_TEXT)).toBe(true)
    })
})
