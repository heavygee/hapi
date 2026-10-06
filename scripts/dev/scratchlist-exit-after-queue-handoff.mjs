#!/usr/bin/env node
/**
 * Peer-stack handoff for scratchlist #959 — drives real SessionChat, screenshot + optional video.
 *
 * Usage:
 *   node scripts/dev/scratchlist-exit-after-queue-handoff.mjs [stack-name]
 *
 * Reads localdocs/peer-stack.env unless env vars already set.
 *
 * Pacing (readable recordings): HAPI_PEER_HANDOFF_STEP_DELAY_MS (default 1200),
 * HAPI_PEER_HANDOFF_SLOW_MO_MS (default 400).
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
    annotatedVideoPaths,
    clickForHuman,
    startAnnotatedScreencast,
    stopAnnotatedScreencast,
} from './playwright-annotated-video.mjs'

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..')

function loadEnvFile(path) {
    if (!existsSync(path)) return
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq)
        if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1)
    }
}

loadEnvFile(resolve(repoRoot, 'localdocs/peer-stack.env'))

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const sessionId = process.env.HAPI_PEER_SESSION_ID ?? ''
const token = process.env.HAPI_PEER_CLI_TOKEN ?? ''
const screenshotPath = resolve(process.env.HAPI_PEER_SCREENSHOT ?? 'localdocs/playwright-runs/959-peer-stack-handoff.png')
const videoRunsDir = resolve('localdocs/playwright-runs')
const videoBasename = process.env.HAPI_PEER_VIDEO_BASENAME ?? '959-peer-stack-handoff'
const { webm: videoWebmPath, mp4: videoMp4Path } = annotatedVideoPaths(videoRunsDir, videoBasename)

if (!hubUrl || !sessionId || !token) {
    console.error('missing peer stack env — run hapi-peer-stack up first')
    process.exit(2)
}

const STEP_DELAY_MS = Number(process.env.HAPI_PEER_HANDOFF_STEP_DELAY_MS ?? 1200)
const SLOW_MO_MS = Number(process.env.HAPI_PEER_HANDOFF_SLOW_MO_MS ?? 400)

function launchOptions() {
    const chromePath = process.env.PLAYWRIGHT_CHROME_PATH?.trim()
    const base = { headless: true, slowMo: SLOW_MO_MS }
    if (chromePath) return { ...base, executablePath: chromePath }
    if (process.platform === 'linux' && !process.env.PLAYWRIGHT_BUNDLED_CHROMIUM) {
        return { ...base, channel: 'chrome' }
    }
    return base
}

async function settle(page) {
    if (STEP_DELAY_MS > 0) {
        await page.waitForTimeout(STEP_DELAY_MS)
    }
}

const storageKey = `hapi_access_token::${hubUrl}`
const browser = await chromium.launch(launchOptions())
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
})
const page = await context.newPage()
mkdirSync(videoRunsDir, { recursive: true })
await startAnnotatedScreencast(page, {
    path: videoWebmPath,
    size: { width: 1440, height: 900 },
})
await page.addInitScript(({ key, tok }) => {
    localStorage.setItem(key, tok)
}, { key: storageKey, tok: token })

try {
    await page.goto(`${hubUrl}/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await settle(page)
    const toggle = page.getByRole('button', { name: 'Scratchlist drawer' })
    await toggle.waitFor({ state: 'visible', timeout: 60_000 })
    await clickForHuman(toggle)
    await page.getByPlaceholder('Type a message...').fill('Peer stack handoff #959')
    await settle(page)
    await clickForHuman(page.getByRole('button', { name: 'Send to scratchlist' }), {
        waitFor: () => page.getByText('Peer stack handoff #959').waitFor({ timeout: 10000 }),
    })
    await clickForHuman(page.getByRole('button', { name: 'Send to queue' }).first())
    await toggle.waitFor({ state: 'visible' })
    const pressed = await toggle.getAttribute('aria-pressed')
    if (pressed !== 'false') {
        throw new Error(`expected scratchlist mode off after queue send, aria-pressed=${pressed}`)
    }
    mkdirSync(dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: false })
    console.log(JSON.stringify({
        ok: true,
        screenshot: screenshotPath,
        videoWebm: videoWebmPath,
        videoMp4: videoMp4Path,
        url: page.url(),
        hubUrl,
        sessionId,
    }, null, 2))
} catch (error) {
    mkdirSync(dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {})
    console.error(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        screenshot: screenshotPath,
    }, null, 2))
    process.exitCode = 1
} finally {
    await stopAnnotatedScreencast(page).catch(() => {})
    await context.close()
    await browser.close()
}
