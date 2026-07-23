#!/usr/bin/env bun
/**
 * hapi-dogfood-shot — reliable PNG proof capture + easy HAPI inline display.
 *
 * This is NOT a test runner. Tests (vitest / Playwright expects) stay tests.
 * This makes the *proof artifact* path reliable:
 *   disk PNG → inline in this HAPI session (display_image) → same file ready for
 *   upstream PR attach (prints paths + optional --pr-checklist).
 *
 * Two modes:
 *   A) Capture: open SessionChat / file viewer on :3006|peer, screenshot
 *   B) --from PATH: skip browser; display an existing Playwright/e2e PNG
 *
 * Usage:
 *   hapi-dogfood-shot
 *   hapi-dogfood-shot --from localdocs/playwright-runs/959-peer-stack.png
 *   hapi-dogfood-shot --goto-file web/src/lib/foo.ts --title "file viewer"
 *   hapi-dogfood-shot --expect-link "/file?" --title "autolink"
 *   hapi-dogfood-shot --from proof.png --pr-checklist
 *   hapi-dogfood-shot --from proof.png --pr heavygee/hapi#76
 *   hapi-dogfood-shot --no-display
 *
 * Defaults: hub $HAPI_HUB_URL|$HAPI_HOST|http://127.0.0.1:3006
 *           session $HAPI_SESSION_ID (required for capture / display self)
 *
 * Auth: lib/hapi-hub-auth.mjs (live hub HAPI_HOME — not ~/.hapi alone).
 * PR attach: lib/hapi-pr-attach-proof.mjs (Releases API — not user-attachments).
 * See: docs/tooling/dogfood-shot.md
 */
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, resolve, join, basename, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveHubAuth } from './lib/hapi-hub-auth.mjs'
import { attachProofToPr, parsePrSpec } from './lib/hapi-pr-attach-proof.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MIRROR = resolve(SCRIPT_DIR, '../..')

function parseArgs(argv) {
    const out = {
        hub: process.env.HAPI_HUB_URL ?? process.env.HAPI_HOST ?? 'http://127.0.0.1:3006',
        session: process.env.HAPI_SESSION_ID ?? '',
        title: '',
        out: '',
        from: '',
        expect: [],
        expectLink: [],
        click: '',
        gotoFile: '',
        display: true,
        fullPage: false,
        scrollPasses: 40,
        prChecklist: false,
        pr: '',
        repo: '',
        assetRepo: '',
        prDryRun: false,
        prNoComment: false,
        prBody: '',
        help: false,
    }
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i]
        if (a === '-h' || a === '--help') out.help = true
        else if (a === '--hub') out.hub = (argv[++i] ?? '').replace(/\/$/, '')
        else if (a === '--session') out.session = argv[++i] ?? ''
        else if (a === '--title') out.title = argv[++i] ?? ''
        else if (a === '--out') out.out = argv[++i] ?? ''
        else if (a === '--from') out.from = argv[++i] ?? ''
        else if (a === '--expect') out.expect.push(argv[++i] ?? '')
        else if (a === '--expect-link') out.expectLink.push(argv[++i] ?? '')
        else if (a === '--click') out.click = argv[++i] ?? ''
        else if (a === '--goto-file') out.gotoFile = argv[++i] ?? ''
        else if (a === '--no-display') out.display = false
        else if (a === '--full-page') out.fullPage = true
        else if (a === '--scroll-passes') out.scrollPasses = Number(argv[++i] ?? 40)
        else if (a === '--pr-checklist') out.prChecklist = true
        else if (a === '--pr') out.pr = argv[++i] ?? ''
        else if (a === '--repo') out.repo = argv[++i] ?? ''
        else if (a === '--asset-repo') out.assetRepo = argv[++i] ?? ''
        else if (a === '--pr-dry-run') out.prDryRun = true
        else if (a === '--pr-no-comment') out.prNoComment = true
        else if (a === '--pr-body') out.prBody = argv[++i] ?? ''
        else {
            console.error(`unknown arg: ${a}`)
            out.help = true
        }
    }
    return out
}

function usage() {
    console.error(`usage: hapi-dogfood-shot [options]

  Proof helper (not a test runner). Capture or re-display a PNG, inline to HAPI.

  --from PATH            skip browser; display/copy an existing e2e/Playwright PNG
  --hub URL              default http://127.0.0.1:3006
  --session UUID         default $HAPI_SESSION_ID (needed for capture + display)
  --title TEXT           caption for display_image
  --out PATH             png path (default localdocs/playwright-runs/dogfood-<ts>.png)
  --expect TEXT          after capture: assert body contains TEXT (repeatable)
  --expect-link SUBSTR   after capture: assert an <a> href contains SUBSTR
  --click SELECTOR       after capture: force-click, then re-screenshot
  --goto-file RELPATH    capture session file viewer for RELPATH
  --no-display           skip hapi-display-image.mjs (disk only)
  --pr-checklist         print manual drag-drop blurb (legacy; prefer --pr)
  --pr SPEC              attach proof to PR via Releases API (owner/repo#N or N)
  --repo OWNER/REPO      required when --pr is a bare number
  --asset-repo OWNER/REPO  host release here (default: PR repo). Use fork when
                         commenting on upstream without release rights.
  --pr-dry-run           resolve --pr + print plan; no upload/comment
  --pr-no-comment        upload release asset only; print URL (no PR comment)
  --pr-body TEXT         optional PR comment preamble (markdown)
  --full-page            fullPage screenshot
  --scroll-passes N      virtualized-list scroll iterations (default 40)

  From a Playwright spec (after you already asserted + wrote SCREENSHOT_PATH):
      hapi-dogfood-shot --from "$SCREENSHOT_PATH" --title "peer #NNN proof"
      hapi-dogfood-shot --from "$SCREENSHOT_PATH" --pr heavygee/hapi#76
`)
}

function defaultOutDir() {
    if (process.env.HAPI_PEER_WORKTREE) {
        return join(process.env.HAPI_PEER_WORKTREE, 'localdocs/playwright-runs')
    }
    const cwd = process.cwd()
    if (cwd.includes('/worktrees/')) {
        const m = cwd.match(/^(.*?\/worktrees\/[^/]+)/)
        if (m) return join(m[1], 'localdocs/playwright-runs')
    }
    const local = join(cwd, 'localdocs/playwright-runs')
    if (existsSync(join(cwd, 'localdocs')) || cwd.includes('/hapi')) return local
    return join(MIRROR, 'localdocs/playwright-runs')
}

function loadPlaywright() {
    const require = createRequire(import.meta.url)
    for (const c of [join(MIRROR, 'node_modules/playwright'), join(process.cwd(), 'node_modules/playwright'), 'playwright']) {
        try { return require(c) } catch { /* next */ }
    }
    throw new Error('playwright not found — run bun install at ~/coding/hapi (mirror)')
}

function encodeBase64Path(value) {
    return Buffer.from(value, 'utf8').toString('base64')
}

function printPrChecklist(paths) {
    console.error('')
    console.error('── Upstream PR attach checklist ──')
    console.error('  Do NOT git-add these binaries.')
    console.error('  Preferred (PAT / zero-click): hapi-dogfood-shot --from <png> --pr owner/repo#N')
    console.error('    → prerelease asset URL (not user-attachments; see dogfood-shot.md).')
    console.error('  Manual (exact user-attachments/assets/…): drag-drop in GitHub PR UI.')
    for (const p of paths) {
        console.error(`  • ${p}`)
    }
    console.error('  Same files already inlined in HAPI chat via display_image (if --no-display was not set).')
    console.error('')
}

function runPrAttach(args, outPath) {
    if (!args.pr) return null
    const parsed = parsePrSpec(args.pr, args.repo)
    const result = attachProofToPr({
        filePath: outPath,
        prRepo: parsed.nameWithOwner,
        assetRepo: args.assetRepo || parsed.nameWithOwner,
        prNumber: parsed.number,
        title: args.title || basename(outPath),
        body: args.prBody || undefined,
        dryRun: args.prDryRun,
        postComment: !args.prNoComment,
    })
    if (result.dryRun) {
        console.error('hapi-dogfood-shot: --pr-dry-run plan')
        console.error(`  strategy=${result.strategy} pr=${result.prRepo}#${result.prNumber}`)
        console.error(`  asset-repo=${result.assetRepo} tag=${result.tag} asset=${result.assetName}`)
        console.error(`  file=${result.filePath}`)
        return result
    }
    console.error(`hapi-dogfood-shot: PR attach OK strategy=${result.strategy}`)
    console.error(`  url=${result.url}`)
    if (result.commentUrl) console.error(`  comment=${result.commentUrl}`)
    console.log(result.url)
    return result
}

async function displayImage(auth, sessionId, outPath, title) {
    const displayScript = join(SCRIPT_DIR, 'hapi-display-image.mjs')
    const r = spawnSync('bun', [displayScript, 'self', outPath, title], {
        env: {
            ...process.env,
            HAPI_HOST: auth.hubUrl,
            HAPI_SESSION_ID: sessionId,
            CLI_API_TOKEN: auth.cliApiToken,
            HAPI_SETTINGS: auth.tokenSource.startsWith('/') ? auth.tokenSource : process.env.HAPI_SETTINGS,
        },
        encoding: 'utf8',
    })
    if (r.stdout) process.stdout.write(r.stdout)
    if (r.stderr) process.stderr.write(r.stderr)
    return r.status ?? 1
}

async function main() {
    const args = parseArgs(process.argv)
    if (args.help) {
        usage()
        process.exit(2)
    }

    // Mode B: --from existing proof PNG (tests already produced the artifact)
    if (args.from) {
        const src = isAbsolute(args.from) ? args.from : resolve(process.cwd(), args.from)
        if (!existsSync(src)) {
            console.error(`hapi-dogfood-shot: --from not found: ${src}`)
            process.exit(2)
        }
        let outPath = args.out || src
        if (args.out && resolve(args.out) !== resolve(src)) {
            mkdirSync(dirname(outPath), { recursive: true })
            copyFileSync(src, outPath)
        }
        console.log(outPath)
        if (args.prChecklist) printPrChecklist([outPath])
        try {
            runPrAttach(args, outPath)
        } catch (err) {
            console.error(`hapi-dogfood-shot: PR attach failed: ${err?.message || err}`)
            process.exit(1)
        }

        if (!args.display) return

        if (!args.session) {
            console.error('hapi-dogfood-shot: --from needs --session / $HAPI_SESSION_ID to display')
            process.exit(2)
        }
        const auth = await resolveHubAuth(args.hub)
        console.error(`hapi-dogfood-shot: display-only hub=${auth.hubUrl} token=${auth.tokenSource}`)
        const status = await displayImage(auth, args.session, outPath, args.title || basename(outPath))
        if (status !== 0) process.exit(status)
        return
    }

    // Mode A: capture
    if (!args.session) {
        console.error('hapi-dogfood-shot: missing --session / $HAPI_SESSION_ID')
        usage()
        process.exit(2)
    }

    const auth = await resolveHubAuth(args.hub)
    console.error(`hapi-dogfood-shot: capture hub=${auth.hubUrl} token=${auth.tokenSource} session=${args.session.slice(0, 8)}…`)

    mkdirSync(defaultOutDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outPath = args.out || join(defaultOutDir(), `dogfood-${stamp}.png`)
    mkdirSync(dirname(outPath), { recursive: true })

    const { chromium } = loadPlaywright()
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: `hapi_access_token::${auth.hubUrl}`, token: auth.cliApiToken })

    let targetUrl = `${auth.hubUrl}/sessions/${args.session}`
    if (args.gotoFile) {
        const pathB64 = encodeURIComponent(encodeBase64Path(args.gotoFile))
        targetUrl = `${auth.hubUrl}/sessions/${args.session}/file?path=${pathB64}`
    }

    // NEVER networkidle — SSE keeps :3006 "loading" forever.
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const login = page.getByPlaceholder('Access token')
    if (await login.isVisible({ timeout: 2500 }).catch(() => false)) {
        await login.fill(auth.cliApiToken)
        await page.getByRole('button', { name: /sign in|login|connect/i }).click()
        await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
    }

    if (!args.gotoFile) {
        await page.locator('.aui-md, .happy-chat-text, [data-message-id]').first()
            .waitFor({ state: 'visible', timeout: 60_000 })
            .catch(() => {})
        await page.waitForTimeout(1500)
        await page.keyboard.press('Home').catch(() => {})
        for (let i = 0; i < args.scrollPasses; i++) {
            const body = await page.evaluate(() => document.body?.innerText ?? '')
            if (args.expect.length && args.expect.every((t) => body.includes(t))) break
            if (args.expectLink.length) {
                const hrefs = await page.evaluate(() =>
                    [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '')
                )
                if (args.expectLink.every((s) => hrefs.some((h) => h.includes(s)))) break
            }
            await page.mouse.wheel(0, 1000)
            await page.waitForTimeout(80)
        }
    } else {
        await page.waitForTimeout(2000)
    }

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '')
    const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a')].map((a) => ({
            text: (a.innerText || '').trim().slice(0, 80),
            href: a.getAttribute('href') || '',
        }))
    )
    const failures = []
    for (const t of args.expect) {
        if (!bodyText.includes(t)) failures.push(`--expect not found: ${JSON.stringify(t)}`)
    }
    for (const s of args.expectLink) {
        if (!hrefs.some((h) => h.href.includes(s))) {
            failures.push(`--expect-link no href contains ${JSON.stringify(s)}`)
        }
    }

    if (args.click) {
        const loc = page.locator(args.click).first()
        await loc.waitFor({ state: 'attached', timeout: 15_000 })
        await loc.scrollIntoViewIfNeeded().catch(() => {})
        await loc.click({ force: true, timeout: 15_000 })
        await page.waitForTimeout(1500)
    }

    await page.screenshot({ path: outPath, fullPage: args.fullPage })
    writeFileSync(outPath.replace(/\.png$/i, '.json'), JSON.stringify({
        hub: auth.hubUrl,
        session: args.session,
        tokenSource: auth.tokenSource,
        url: page.url(),
        outPath,
        expect: args.expect,
        expectLink: args.expectLink,
        click: args.click || null,
        gotoFile: args.gotoFile || null,
        hrefSample: hrefs.filter((h) => h.href.includes('/file')).slice(0, 20),
        failures,
        at: new Date().toISOString(),
    }, null, 2))
    await browser.close()

    if (failures.length) {
        console.error(`hapi-dogfood-shot: ASSERT FAIL (${failures.length})`)
        for (const f of failures) console.error(`  - ${f}`)
        console.error(`screenshot (debug): ${outPath}`)
        process.exit(1)
    }

    console.log(outPath)
    if (args.prChecklist) printPrChecklist([outPath])
    try {
        runPrAttach(args, outPath)
    } catch (err) {
        console.error(`hapi-dogfood-shot: capture OK but PR attach failed: ${err?.message || err}`)
        process.exit(1)
    }

    if (args.display) {
        const status = await displayImage(auth, args.session, outPath, args.title || `dogfood shot ${args.session.slice(0, 8)}`)
        if (status !== 0) {
            console.error('hapi-dogfood-shot: capture OK but display_image failed — PNG is on disk')
            process.exit(status)
        }
    }
}

main().catch((err) => {
    console.error(`hapi-dogfood-shot: ${err?.stack || err}`)
    process.exit(1)
})
