#!/usr/bin/env bun
/**
 * Soup hot-file consistency gate — run from hapi-driver-rebuild --verify.
 *
 * Catches layer-collision class bugs where syncEngine keeps rpcGateway calls
 * but a later manifest layer dropped the matching rpcGateway method (or REST route).
 *
 * Usage: bun run hapi-soup-hotfiles-check.mjs [driver-dir]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const driver = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME, 'coding/hapi/driver')

function read(rel) {
    return readFileSync(join(driver, rel), 'utf8')
}

const syncEngine = read('hub/src/sync/syncEngine.ts')
const rpcGateway = read('hub/src/sync/rpcGateway.ts')

const calls = [...new Set([...syncEngine.matchAll(/this\.rpcGateway\.(\w+)\(/g)].map((m) => m[1]))]
const methods = new Set([...rpcGateway.matchAll(/^\s+async (\w+)\(/gm)].map((m) => m[1]))

const missing = calls.filter((name) => !methods.has(name))
if (missing.length > 0) {
    console.error('hapi-soup-hotfiles-check: FAIL')
    console.error('  syncEngine -> rpcGateway calls missing from rpcGateway:', missing.join(', '))
    console.error('  Add a collision-repair manifest layer — docs/tooling/driver-soup.md § Layer collisions.')
    process.exit(1)
}

if (syncEngine.includes('listCodexSessionsForMachine')) {
    const machines = read('hub/src/web/routes/machines.ts')
    if (!machines.includes('/codex-sessions')) {
        console.error('hapi-soup-hotfiles-check: FAIL')
        console.error('  syncEngine.listCodexSessionsForMachine but machines.ts missing GET /codex-sessions')
        process.exit(1)
    }
}

console.log(`hapi-soup-hotfiles-check: OK (${calls.length} rpcGateway call site(s) checked)`)
