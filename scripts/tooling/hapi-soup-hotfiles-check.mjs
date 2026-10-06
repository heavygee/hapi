#!/usr/bin/env bun
/**
 * Soup hot-file consistency gate — run from hapi-driver-rebuild --verify.
 *
 * Catches layer-collision class bugs where syncEngine keeps rpcGateway calls
 * but a later manifest layer dropped the matching rpcGateway method (or REST route).
 *
 * Usage: bun run hapi-soup-hotfiles-check.mjs [driver-dir]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const driver = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME, 'coding/hapi/driver')

function read(rel) {
    return readFileSync(join(driver, rel), 'utf8')
}

const syncEngine = read('hub/src/sync/syncEngine.ts')
const rpcGateway = read('hub/src/sync/rpcGateway.ts')

const calls = [...new Set([...syncEngine.matchAll(/this\.rpcGateway\.(\w+)\(/g)].map((m) => m[1]))]
const methods = new Set([
    ...rpcGateway.matchAll(/^\s+(?:async )?(\w+)\(/gm),
].map((m) => m[1]).filter((name) => name !== 'constructor'))

const missing = calls.filter((name) => !methods.has(name))
if (missing.length > 0) {
    console.error('hapi-soup-hotfiles-check: FAIL')
    console.error('  syncEngine -> rpcGateway calls missing from rpcGateway:', missing.join(', '))
    console.error('  Add a collision-repair manifest layer — docs/tooling/driver-soup.md § Layer collisions.')
    process.exit(1)
}

// Upstream 0.23.1 (#1088) wires listCodexSessionsForMachine through
// hub/src/web/routes/codexDesktop.ts (listCodexSessionsViaMachine), not the
// older fork-only GET /machines/:id/codex-sessions route. Accept either.
if (syncEngine.includes('listCodexSessionsForMachine')) {
    const machines = read('hub/src/web/routes/machines.ts')
    const codexDesktop = read('hub/src/web/routes/codexDesktop.ts')
    const hasMachinesRoute = machines.includes('/codex-sessions')
    const hasDesktopWire = codexDesktop.includes('listCodexSessionsViaMachine')
        || codexDesktop.includes('listCodexSessionsForMachine')
    if (!hasMachinesRoute && !hasDesktopWire) {
        console.error('hapi-soup-hotfiles-check: FAIL')
        console.error('  syncEngine.listCodexSessionsForMachine but neither machines.ts GET /codex-sessions nor codexDesktop listCodexSessionsViaMachine present')
        process.exit(1)
    }
}

console.log(`hapi-soup-hotfiles-check: OK (${calls.length} rpcGateway call site(s) checked)`)

const primary = process.env.HAPI_PRIMARY ?? join(process.env.HOME, 'coding/hapi')
const routeMounts = join(primary, 'scripts/tooling/hapi-soup-route-mounts-check.mjs')
if (existsSync(routeMounts)) {
    const r = spawnSync('bun', ['run', routeMounts, driver], { stdio: 'inherit' })
    if (r.status !== 0) process.exit(r.status ?? 1)
}
const bindings = join(primary, 'scripts/tooling/verify-sessionlist-bindings.mjs')
if (existsSync(bindings)) {
    const r = spawnSync('bun', ['run', bindings, driver], { stdio: 'inherit' })
    if (r.status !== 0) process.exit(r.status ?? 1)
}

const composerBindings = join(primary, 'scripts/tooling/verify-happycomposer-bindings.mjs')
if (existsSync(composerBindings)) {
    const r = spawnSync('bun', ['run', composerBindings, driver], { stdio: 'inherit' })
    if (r.status !== 0) process.exit(r.status ?? 1)
}

const externalRefsPreserve = join(primary, 'scripts/tooling/verify-externalrefs-preserve.mjs')
if (existsSync(externalRefsPreserve)) {
    const r = spawnSync('bun', ['run', externalRefsPreserve, driver], { stdio: 'inherit' })
    if (r.status !== 0) process.exit(r.status ?? 1)
}
