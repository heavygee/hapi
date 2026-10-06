#!/usr/bin/env bun
/**
 * hapi-session-send-smoke — dogfood gate: composer Enter/Send must not throw.
 *
 * Session-open smoke only checks mount (composer textbox present). Tip-forward
 * absorb 64a116f47 shipped a mount-green tip where Enter was a no-op:
 * `ReferenceError: restoredIntent is not defined`. That cuts the operator off
 * from telling agents anything is wrong — fundamental, not cosmetic.
 *
 * This probe types into the live composer and clicks Send (and presses Enter
 * on a second pass). Message POSTs are aborted so we do not yank live agents
 * or enqueue real work — we only prove the click handler does not throw.
 *
 * Usage:
 *   hapi-session-send-smoke
 *   hapi-session-send-smoke --hub http://127.0.0.1:3006 --ids id1
 *
 * Exit: 0 ok · 1 smoke fail · 2 usage/setup
 *
 * Canon: docs/tooling/driver-soup.md § HappyComposer send-intent
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MIRROR = join(SCRIPT_DIR, '../..')
const PROBE_TEXT = `__hapi_send_smoke_${Date.now()}__`

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

function isFatalJsError(text) {
    const t = String(text)
    if (/restoredIntent\s+is\s+not\s+defined/i.test(t)) return true
    if (/resetPendingSendIntent\s+is\s+not\s+defined/i.test(t)) return true
    if (/canViewAgentTerminal\s+is\s+not\s+defined/i.test(t)) return true
    if (/ReferenceError/i.test(t) && /not defined/i.test(t)) return true
    return false
}

async function signIn(page, hub, token) {
    await page.goto(`${hub}/`, { waitUntil: 'networkidle', timeout: 90_000 })
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
}

async function composerLocator(page) {
    const rich = page.locator('[contenteditable="true"]').first()
    if ((await rich.count()) > 0 && (await rich.isVisible().catch(() => false))) return rich
    const ta = page.locator('textarea').first()
    if ((await ta.count()) > 0 && (await ta.isVisible().catch(() => false))) return ta
    return page.locator('[role="textbox"]').first()
}

async function hasShowError(page) {
    return page.locator('button').evaluateAll((buttons) =>
        buttons.some((b) => (b.textContent || '').trim() === 'Show Error'),
    )
}

/**
 * Type + trigger send. Message POSTs are aborted — we only care that the
 * handler does not ReferenceError before/at send().
 */
async function probeSend(page, mode) {
    const pageErrors = []
    const consoleErrors = []
    const onPageError = (err) => pageErrors.push(String(err?.message ?? err))
    const onConsole = (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
    }
    page.on('pageerror', onPageError)
    page.on('console', onConsole)

    let sendPostSeen = 0
    await page.route('**/api/sessions/**/messages**', async (route) => {
        if (route.request().method() === 'POST') {
            sendPostSeen += 1
            // Abort delivery — probe must not enqueue real agent work.
            await route.abort('failed')
            return
        }
        await route.continue()
    })

    try {
        const composer = await composerLocator(page)
        await composer.click({ timeout: 15_000 })
        await composer.fill('')
        await composer.fill(PROBE_TEXT)
        await page.waitForTimeout(300)

        if (mode === 'click') {
            const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
            await sendBtn.click({ timeout: 10_000 })
        } else {
            await composer.press('Enter')
        }
        await page.waitForTimeout(1500)

        const boundary = await hasShowError(page)
        const fatalPage = pageErrors.filter(isFatalJsError)
        const fatalConsole = consoleErrors.filter(isFatalJsError)
        const composerGone = (await page.locator('[role="textbox"], textarea, [contenteditable]').count()) === 0

        return {
            ok: fatalPage.length === 0 && fatalConsole.length === 0 && !boundary && !composerGone,
            boundary,
            composerGone,
            fatalPage,
            fatalConsole,
            sendPostSeen,
            pageErrors,
            consoleErrors: consoleErrors.slice(0, 8),
        }
    } finally {
        page.off('pageerror', onPageError)
        page.off('console', onConsole)
        await page.unroute('**/api/sessions/**/messages**').catch(() => {})
    }
}

async function main() {
    const args = parseArgs(process.argv)
    if (args.help) {
        console.error('usage: hapi-session-send-smoke [--hub URL] [--ids id1,id2] [--settings PATH]')
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
        const list = sessions.sessions ?? []
        // Prefer active non-thinking (composer live, less likely mid-turn).
        ids = list
            .filter((s) => s.active && !s.thinking)
            .slice(0, 1)
            .map((s) => s.id)
        if (ids.length === 0) {
            ids = list.filter((s) => s.active).slice(0, 1).map((s) => s.id)
        }
        if (ids.length === 0) {
            ids = list.slice(0, 1).map((s) => s.id)
        }
    }
    if (ids.length === 0) {
        console.error('no session ids to send-smoke')
        process.exit(2)
    }

    const { chromium } = loadPlaywright()
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    try {
        await signIn(page, args.hub, token)

        let fail = 0
        for (const id of ids) {
            await page.goto(`${args.hub}/sessions/${id}`, {
                waitUntil: 'domcontentloaded',
                timeout: 60_000,
            })
            await page.waitForTimeout(4000)

            if (await hasShowError(page)) {
                console.log(`${id.slice(0, 8)} FAIL boundary=true (before send probe)`)
                fail += 1
                continue
            }
            const hasComposer = (await page.locator('[role="textbox"], textarea, [contenteditable]').count()) > 0
            if (!hasComposer) {
                console.log(`${id.slice(0, 8)} FAIL composer=false (before send probe)`)
                fail += 1
                continue
            }

            for (const mode of ['click', 'enter']) {
                const result = await probeSend(page, mode)
                const detail = [
                    `mode=${mode}`,
                    `boundary=${result.boundary}`,
                    `composerGone=${result.composerGone}`,
                    `fatalPage=${result.fatalPage.length}`,
                    `fatalConsole=${result.fatalConsole.length}`,
                    `sendPostSeen=${result.sendPostSeen}`,
                ].join(' ')
                if (!result.ok) {
                    console.log(`${id.slice(0, 8)} FAIL ${detail}`)
                    if (result.fatalPage[0]) console.error(`  pageerror: ${result.fatalPage[0]}`)
                    if (result.fatalConsole[0]) console.error(`  console: ${result.fatalConsole[0]}`)
                    fail += 1
                    break
                }
                console.log(`${id.slice(0, 8)} OK ${detail}`)
            }
        }

        await browser.close()
        if (fail) {
            console.error(`hapi-session-send-smoke: FAIL (${fail} probe(s))`)
            process.exit(1)
        }
        console.log(`hapi-session-send-smoke: OK (${ids.length} session(s), click+enter)`)
    } catch (err) {
        await browser.close().catch(() => {})
        console.error('hapi-session-send-smoke: ERROR', err)
        process.exit(1)
    }
}

await main()
