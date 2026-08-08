#!/usr/bin/env bun
/**
 * Fail-closed gate: tip-forward unions must not leave send-path / terminal
 * identifiers referenced without a local binding.
 *
 * Incident 2026-08-08: tip-forward absorb `64a116f47` kept
 * `pendingSchedule == null ? restoredIntent : 'default'` in HappyComposer
 * but dropped `const restoredIntent = …` + `resetPendingSendIntent`. Session-
 * open smoke stayed green (mount only); composer Enter was a no-op with
 * ReferenceError in dist. Same class as SessionList unbound helpers and the
 * same-day `canViewAgentTerminal` SessionChat miss.
 *
 * Invoked from verify-soup-web-dist.mjs, hapi-driver-build-web, and
 * hapi-soup-hotfiles-check.mjs.
 *
 * Usage: bun scripts/tooling/verify-happycomposer-bindings.mjs [driver-dir]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const driver = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME, 'coding/hapi/driver')
const webSrc = join(driver, 'web/src')

/** Identifiers that must be bound if referenced (use, not only declaration). */
const CHECKS = [
    {
        rel: 'web/src/components/AssistantChat/HappyComposer.tsx',
        names: ['restoredIntent', 'resetPendingSendIntent'],
    },
    {
        rel: 'web/src/components/SessionChat.tsx',
        names: ['canViewAgentTerminal'],
    },
]

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
        new RegExp(`\\b${name}\\s*=`), // destructure / assign
        new RegExp(`\\bimport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
        // param: async (intent… or ({ restoredIntent })
        new RegExp(`\\([^)]*\\b${name}\\b[^)]*\\)\\s*=>`),
        new RegExp(`\\([^)]*\\b${name}\\b[^)]*\\)\\s*\\{`),
    ]
    return patterns.some((re) => re.test(src))
}

/** True if name appears as an identifier use (not only inside its own binding). */
function hasUse(src, name) {
    // Word-boundary hits excluding the binding introducers we already require.
    const re = new RegExp(`\\b${name}\\b`)
    if (!re.test(src)) return false
    // If the only hits are the declaration line(s), still OK when hasBinding —
    // we only fail when used AND unbound.
    return true
}

const failures = []

for (const { rel, names } of CHECKS) {
    const path = join(driver, rel)
    let raw
    try {
        raw = readFileSync(path, 'utf8')
    } catch {
        // Optional on thin tips that lack the file — skip.
        continue
    }
    const src = stripComments(raw)
    for (const name of names) {
        if (!hasUse(src, name)) continue
        if (hasBinding(src, name)) continue
        failures.push(`${rel}: references ${name} without local const/let/function/param binding`)
    }
}

if (failures.length > 0) {
    console.error('verify-happycomposer-bindings: FAIL')
    for (const line of failures) console.error(`  - ${line}`)
    console.error(
        '  Tip-forward unions on HappyComposer / SessionChat are heal-required.',
    )
    console.error(
        '  See docs/tooling/driver-soup.md § HappyComposer send-intent / SessionChat terminal.',
    )
    process.exit(1)
}

console.log('verify-happycomposer-bindings: OK (send-intent + terminal bindings)')
