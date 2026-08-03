#!/usr/bin/env bun
/**
 * Fail-closed gate: SessionList / SessionRowSummary must not call getTodoProgress
 * (or other hot helpers) without a local binding or an explicit import.
 *
 * Double incident 2026-07-29: rich-composer remat + session-header-machine-meta
 * both left `const todoProgress = getTodoProgress(s)` with no definition →
 * full-page "getTodoProgress is not defined" on :3006.
 *
 * Invoked from verify-soup-web-dist.mjs and hapi-soup-hotfiles-check.mjs.
 *
 * Usage: bun scripts/tooling/verify-sessionlist-bindings.mjs [driver-dir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const driver = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME, 'coding/hapi/driver')
const webSrc = join(driver, 'web/src')

const HOT_CALLS = ['getTodoProgress', 'getAttentionLabel', 'getSessionTimeLabel']

function walk(dir, out = []) {
    let entries
    try {
        entries = readdirSync(dir)
    } catch {
        return out
    }
    for (const name of entries) {
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, out)
        else if (/\.(tsx|ts)$/.test(name)) out.push(p)
    }
    return out
}

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function hasBinding(src, name) {
    const patterns = [
        new RegExp(`\\bfunction\\s+${name}\\b`),
        new RegExp(`\\bconst\\s+${name}\\s*=`),
        new RegExp(`\\blet\\s+${name}\\s*=`),
        new RegExp(`\\bimport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
        new RegExp(`\\bimport\\s+${name}\\b`),
    ]
    return patterns.some((re) => re.test(src))
}

function hasCall(src, name) {
    return new RegExp(`\\b${name}\\s*\\(`).test(src)
}

const targets = walk(webSrc).filter((p) => {
    const base = p.split('/').pop() ?? ''
    return /SessionList/.test(base) || base === 'SessionRowSummary.tsx'
})

if (targets.length === 0) {
    console.error('verify-sessionlist-bindings: FAIL — no SessionList*/SessionRowSummary.tsx under', webSrc)
    process.exit(1)
}

const failures = []
for (const file of targets) {
    const raw = readFileSync(file, 'utf8')
    const src = stripComments(raw)
    const rel = file.slice(driver.length + 1)
    for (const name of HOT_CALLS) {
        if (!hasCall(src, name)) continue
        if (hasBinding(src, name)) continue
        failures.push(`${rel}: calls ${name}(…) without local function/const/import`)
    }
}

if (failures.length > 0) {
    console.error('verify-sessionlist-bindings: FAIL')
    for (const line of failures) console.error('  -', line)
    console.error('  Restore helpers (prefer web/src/lib/sessionRowHelpers.ts) — docs/tooling/driver-soup.md § SessionList hot-conflict.')
    process.exit(1)
}

// Fail-closed: SessionsPage must not render BOTH an outer chrome toolbar and
// SessionList headerActions (remat "double tools" — 2026-08-03). More than one
// openCodexImportDialog() call site in router.tsx means the outer cluster leaked.
{
    const routerPath = join(webSrc, 'router.tsx')
    let routerSrc = ''
    try {
        routerSrc = stripComments(readFileSync(routerPath, 'utf8'))
    } catch {
        routerSrc = ''
    }
    if (routerSrc) {
        const importCalls = routerSrc.match(/\bopenCodexImportDialog\s*\(/g) ?? []
        if (importCalls.length > 1) {
            console.error('verify-sessionlist-bindings: FAIL')
            console.error(
                `  - web/src/router.tsx: ${importCalls.length} openCodexImportDialog(…) call sites — outer chrome + headerActions double toolbar`,
            )
            console.error(
                '  Keep ONE toolbar via SessionList headerActions; strip outer action cluster (heal 97-router-strip-outer-duplicate-toolbar).',
            )
            process.exit(1)
        }
    }
}

console.log(`verify-sessionlist-bindings: OK (${targets.length} file(s), hot calls bound)`)
