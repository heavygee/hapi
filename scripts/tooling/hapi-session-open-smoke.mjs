#!/usr/bin/env bun
/**
 * hapi-session-open-smoke — post-remat / post-build dogfood gate.
 *
 * verify-soup-web-dist can be green while every session route error-boundaries
 * (React #185). This smoke opens real session URLs on the live hub and fails
 * closed if the error-boundary "Show Error" control appears, or the composer
 * textbox never mounts.
 *
 * Usage:
 *   hapi-session-open-smoke
 *   hapi-session-open-smoke --hub http://127.0.0.1:3006 --ids id1,id2
 *
 * Exit: 0 ok · 1 smoke fail · 2 usage/setup
 *
 * Canon: docs/tooling/driver-soup.md § Post-remat session smoke
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MIRROR = join(SCRIPT_DIR, '../..')

function parseArgs(argv) {
    const out = {
        hub: process.env.HAPI_HUB_URL ?? process.env.HAPI_HOST ?? 'http://127.0.0.1:3006',
        ids: [],
        settings: process.env.HAPI_SETTINGS ?? `${process.env.HOME}/.hapi/settings.json`,
        help: false,
    }
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i]
        if (a === '-h' || a === '--help') out.help = true
        else if (a === '--hub') out.hub = (argv[++i] ?? '').replace(/\/$/, '')
        else if (a === '--ids') out.ids = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        else if (a === '--settings') out.settings = argv[++i] ?? out.settings
        else {
            console.error(`unknown arg: ${a}`)
            out.help = true
        }
    }
    return out
}

function loadPlaywright() {
    const require = createRequire(import.meta.url)
    for (const c of [
        join(MIRROR, 'driver/node_modules/playwright'),
        join(MIRROR, 'node_modules/playwright'),
        join(process.cwd(), 'node_modules/playwright'),
        'playwright',
    ]) {
        try {
            return require(c)
        } catch {
            /* next */
        }
    }
    throw new Error('playwright not found — use driver node_modules (bun install in worktree/driver)')
}

async function main() {
    const args = parseArgs(process.argv)
    if (args.help) {
        console.error('usage: hapi-session-open-smoke [--hub URL] [--ids id1,id2] [--settings PATH]')
        process.exit(2)
    }
    if (!existsSync(args.settings)) {
        console.error(`missing settings: ${args.settings}`)
        process.exit(2)
    }
    const settings = JSON.parse(readFileSync(args.settings, 'utf8'))
    const token = settings.cliApiToken
    if (!token) {
        console.error('settings.cliApiToken missing')
        process.exit(2)
    }

    const auth = await fetch(`${args.hub}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token }),
    }).then((r) => r.json())
    if (!auth?.token) {
        console.error('auth failed')
        process.exit(2)
    }

    let ids = args.ids
    if (ids.length === 0) {
        const sessions = await fetch(`${args.hub}/api/sessions`, {
            headers: { Authorization: `Bearer ${auth.token}` },
        }).then((r) => r.json())
        ids = (sessions.sessions ?? [])
            .filter((s) => s.active)
            .slice(0, 3)
            .map((s) => s.id)
        if (ids.length === 0) {
            ids = (sessions.sessions ?? []).slice(0, 3).map((s) => s.id)
        }
    }
    if (ids.length === 0) {
        console.error('no session ids to smoke')
        process.exit(2)
    }

    const { chromium } = loadPlaywright()
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    try {
        await page.goto(`${args.hub}/`, { waitUntil: 'networkidle', timeout: 90_000 })
        await page.evaluate(async () => {
            for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) {
                await r.unregister()
            }
            for (const k of await caches.keys()) await caches.delete(k)
        })
        await page.reload({ waitUntil: 'networkidle', timeout: 90_000 })
        await page.locator('input[type="password"]').fill(token)
        await page.locator('button:has-text("Sign In")').click()
        await page.waitForTimeout(2000)

        let fail = 0
        for (const id of ids) {
            const logs = []
            const onConsole = (m) => {
                if (m.type() === 'error') logs.push(m.text())
            }
            page.on('console', onConsole)
            await page.goto(`${args.hub}/sessions/${id}`, {
                waitUntil: 'domcontentloaded',
                timeout: 60_000,
            })
            await page.waitForTimeout(4500)
            // Exact label only — chat code blocks often contain the string
            // "Show Error" inside tool output and would false-positive a
            // substring match (2026-08-04 meta session).
            const hasBoundary = await page.locator('button').evaluateAll((buttons) =>
                buttons.some((b) => (b.textContent || '').trim() === 'Show Error')
            )
            const hasComposer = (await page.locator('[role="textbox"], textarea, [contenteditable]').count()) > 0
            const e185 = logs.some((l) => l.includes('#185'))
            const onSession = page.url().includes(id)
            const ok = !hasBoundary && !e185 && hasComposer && onSession
            console.log(
                `${id.slice(0, 8)} ${ok ? 'OK' : 'FAIL'} boundary=${hasBoundary} composer=${hasComposer} e185=${e185}`
            )
            if (!ok) fail += 1
            page.off('console', onConsole)
        }
        await browser.close()
        if (fail) {
            console.error(`hapi-session-open-smoke: FAIL (${fail}/${ids.length})`)
            process.exit(1)
        }
        console.log(`hapi-session-open-smoke: OK (${ids.length} session(s))`)
    } catch (err) {
        await browser.close().catch(() => {})
        console.error('hapi-session-open-smoke: ERROR', err)
        process.exit(1)
    }
}

await main()
