/*
 * Peer-stack e2e for tiann/hapi#1594 — long-pressing the collapsed session
 * search chip starts voice dictation into the query (replacing the old
 * long-press-to-dismiss gesture). Fork main only — run via
 * run-e2e-on-peer-stack.mjs --worktree <product worktree>.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()

const LISTENING_PNG = resolve(artifactRoot, 'localdocs/playwright-runs/1594-search-longpress-dictation-listening.png')
const FINAL_PNG = resolve(artifactRoot, 'localdocs/playwright-runs/1594-search-longpress-dictation-final.png')
const VIDEO_PATH = resolve(artifactRoot, 'localdocs/playwright-runs/1594-search-longpress-dictation.webm')

const TRANSCRIPT = 'ship the voice search'

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

// Stubs the browser mic pipeline (getUserMedia + MediaRecorder) so the standard
// dictation path runs end to end without real hardware or provider credentials.
async function stubMicrophone(page: Page): Promise<void> {
    await page.addInitScript(() => {
        class FakeTrack {
            stop() {}
        }
        class FakeStream {
            getTracks() {
                return [new FakeTrack()]
            }
            getAudioTracks() {
                return [new FakeTrack()]
            }
        }
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: async () => new FakeStream(),
            },
        })

        class FakeMediaRecorder {
            static isTypeSupported() {
                return true
            }
            mimeType: string
            state = 'inactive'
            ondataavailable: ((event: { data: Blob }) => void) | null = null
            onstop: (() => void) | null = null
            onerror: (() => void) | null = null
            constructor(_stream: unknown, opts?: { mimeType?: string }) {
                this.mimeType = opts?.mimeType ?? 'audio/webm'
            }
            start() {
                this.state = 'recording'
            }
            stop() {
                this.state = 'inactive'
                this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) })
                this.onstop?.()
            }
        }
        // @ts-expect-error test stub replaces the real browser constructor
        window.MediaRecorder = FakeMediaRecorder
    })
}

async function mockTranscriptionApi(page: Page): Promise<void> {
    await page.route('**/api/voice/transcription/providers', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ id: 'openai', label: 'OpenAI', modes: ['standard'] }] }),
    }))
    await page.route('**/api/voice/transcription', (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ text: TRANSCRIPT }),
        })
    })
}

// The collapsed search chip only reacts to real touch gestures (useLongPress's
// 'touch-only-native-click' mode makes mouse handlers no-ops), so simulate a
// genuine TouchEvent long-press instead of Playwright's mouse-based click.
// Grab the DOM node once via an ElementHandle rather than re-resolving the
// Locator between the two dispatches — the long-press timer fires mid-hold
// and unmounts the collapsed button (swapped for the expanded input), so a
// lazy Locator.evaluate on touchend would wait forever for a vanished role.
async function longPress(page: Page, locator: Locator, holdMs = 600): Promise<void> {
    const handle = await locator.elementHandle()
    if (!handle) throw new Error('longPress: element handle not found')
    await handle.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const touch = new Touch({
            identifier: 1,
            target: el,
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
        })
        el.dispatchEvent(new TouchEvent('touchstart', {
            touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true,
        }))
    })
    await page.waitForTimeout(holdMs)
    await handle.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const touch = new Touch({
            identifier: 1,
            target: el,
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
        })
        el.dispatchEvent(new TouchEvent('touchend', {
            touches: [], targetTouches: [], changedTouches: [touch], bubbles: true, cancelable: true,
        }))
    })
}

test.describe('long-press search dictation — peer stack (#1594)', () => {
    test.beforeAll(() => {
        requirePeerEnv()
    })

    test.use({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    })

    test('long-pressing the collapsed search chip dictates into the query', async ({ page }) => {
        await injectAuth(page)
        await mockTranscriptionApi(page)
        await stubMicrophone(page)

        const providersResponse = page.waitForResponse((res) => res.url().includes('/api/voice/transcription/providers'))
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await providersResponse

        const searchButton = page.getByRole('button', { name: /^Search sessions/ })
        await expect(searchButton).toBeVisible({ timeout: 60_000 })

        mkdirSync(dirname(LISTENING_PNG), { recursive: true })
        await page.screencast.start({ path: VIDEO_PATH, size: { width: 390, height: 844 } })

        await longPress(page, searchButton)

        const input = page.getByPlaceholder('Search title/path/Agent/machine/ID…')
        await expect(input).toBeVisible({ timeout: 15_000 })

        const stopButton = page.getByRole('button', { name: 'Stop dictation' })
        await expect(stopButton).toBeVisible({ timeout: 15_000 })
        await page.screenshot({ path: LISTENING_PNG })

        await stopButton.click()
        await expect(input).toHaveValue(TRANSCRIPT, { timeout: 15_000 })
        await page.screenshot({ path: FINAL_PNG })

        await page.screencast.stop()
    })
})
