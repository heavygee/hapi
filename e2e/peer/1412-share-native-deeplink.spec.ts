/*
 * Peer-stack e2e for tiann/hapi#1412 — GET /share?url=&text=&title= deep-link ingest.
 * Fork main only — run via run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const SCREENSHOT_PATH = resolve(
    artifactRoot,
    'localdocs/playwright-runs/share-native-deeplink.png',
)

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run hapi-peer-stack up then export vars from localdocs/peer-stack.env '
            + 'or use scripts/dev/run-e2e-on-peer-stack.mjs from fork main.'
        )
    }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })
}

test.describe('share native deep-link ingest — peer stack (#1412)', () => {
    test.beforeAll(() => {
        requirePeerEnv()
    })

    test('GET url+text opens picker and rewrites to ?id=', async ({ page }) => {
        await injectAuth(page)
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })

        const sharedUrl = 'https://example.com/quest-relay-clip'
        const sharedText = 'Quest Audio Relay deep-link proof'
        const qs = new URLSearchParams({
            url: sharedUrl,
            text: sharedText,
            title: 'Deep link title',
        })

        await page.goto(`/share?${qs.toString()}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        await expect(page.getByText('Share to HAPI')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByText(sharedText)).toBeVisible({ timeout: 30_000 })

        await expect.poll(() => {
            const u = new URL(page.url())
            return u.searchParams.get('id')
        }, { timeout: 30_000 }).toBeTruthy()

        const id = new URL(page.url()).searchParams.get('id')
        expect(id).toBeTruthy()
        expect(new URL(page.url()).searchParams.get('url')).toBeNull()
        expect(new URL(page.url()).searchParams.get('text')).toBeNull()

        mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
    })

    test('empty /share still shows no-id UX', async ({ page }) => {
        await injectAuth(page)
        await page.goto('/share', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await expect(page.getByText('No share id was provided')).toBeVisible({ timeout: 30_000 })
    })
})
