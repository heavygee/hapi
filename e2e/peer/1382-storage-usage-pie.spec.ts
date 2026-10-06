/*
 * Peer-stack e2e for tiann/hapi#1382 — interactive storage usage pie in Settings.
 * Fork main only — run via run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1382-storage-usage-pie.png')
const VIDEO_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1382-storage-usage-pie.webm')

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run hapi-peer-stack up then export vars from localdocs/peer-stack.env '
            + 'or use scripts/dev/run-e2e-on-peer-stack.mjs from fork main.',
        )
    }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })
}

test.describe('storage usage pie — peer stack (#1382)', () => {
    test.beforeAll(() => {
        requirePeerEnv()
    })

    test.use({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    })

    test('shows relative-share pie and updates center on legend select', async ({ page }) => {
        await injectAuth(page)
        await page.goto('/settings/storage', { waitUntil: 'domcontentloaded', timeout: 60_000 })

        await expect(page.getByText(/Current on-disk size of the Hub SQLite database/i)).toBeVisible({
            timeout: 30_000,
        })

        const chart = page.getByRole('img', { name: /Relative share/i })
        await expect(chart).toBeVisible({ timeout: 30_000 })

        const center = page.getByTestId('storage-pie-center')
        await expect(center).toBeVisible()
        await expect(center).toContainText(/Database|Write-ahead log|Shared memory/)

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screencast.start({ path: VIDEO_PATH, size: { width: 390, height: 844 } })

        const walLegend = page.getByTestId('storage-pie-legend-wal')
        if (await walLegend.count()) {
            await walLegend.click()
            await expect(center).toContainText('Write-ahead log')
        } else {
            // Peer hub DB may have zero WAL — click whatever second legend exists, or keep database.
            const shmLegend = page.getByTestId('storage-pie-legend-shm')
            if (await shmLegend.count()) {
                await shmLegend.click()
                await expect(center).toContainText('Shared memory')
            }
        }

        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
        await page.screencast.stop()
    })
})
