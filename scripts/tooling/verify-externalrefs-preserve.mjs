#!/usr/bin/env bun
/**
 * Fail-closed: if Metadata carries externalRefs, hub merge MUST carry them
 * forward across sparse CLI update-metadata writes (CONTRIBUTION_FIELDS).
 *
 * Incident 2026-07-30: failed remat left tip mid-stack (before
 * github-pr-awareness). Hub restarted onto that tip — merge lacked
 * CONTRIBUTION_FIELDS — sparse metadata writes wiped PR links from SQLite.
 *
 * Usage: bun run verify-externalrefs-preserve.mjs [driver-dir]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const driver = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME, 'coding/hapi/driver')

function read(rel) {
    const p = join(driver, rel)
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf8')
}

const schemas = read('shared/src/schemas.ts')
if (!schemas) {
    console.error('verify-externalrefs-preserve: FAIL — missing shared/src/schemas.ts')
    process.exit(1)
}

if (!/\bexternalRefs\b/.test(schemas)) {
    console.log('verify-externalrefs-preserve: OK (no externalRefs in schemas — skip)')
    process.exit(0)
}

const sessions = read('hub/src/store/sessions.ts')
if (!sessions) {
    console.error('verify-externalrefs-preserve: FAIL — metadata has externalRefs but hub/src/store/sessions.ts missing')
    process.exit(1)
}

const hasContributionConst = /CONTRIBUTION_FIELDS\s*=\s*\[[^\]]*['"]externalRefs['"]/.test(sessions)
    || /CONTRIBUTION_FIELDS\s*=\s*\[[^\]]*externalRefs/.test(sessions)
const carriesContribution = /carryForwardIfMissing\([^)]*CONTRIBUTION_FIELDS/.test(sessions)
    || /carryForwardIfMissing\(\s*prior,\s*next,\s*merged,\s*CONTRIBUTION_FIELDS\s*\)/.test(sessions)

if (!hasContributionConst || !sessions.includes("carryForwardIfMissing(prior, next, merged, CONTRIBUTION_FIELDS)")) {
    console.error('verify-externalrefs-preserve: FAIL')
    console.error('  shared Metadata includes externalRefs, but hub merge lacks CONTRIBUTION_FIELDS carry-forward.')
    console.error('  Sparse CLI update-metadata will wipe PR chips from SQLite (2026-07-30 incident).')
    console.error('  Fix: hub/src/store/sessions.ts — CONTRIBUTION_FIELDS = [\'externalRefs\'] + carryForwardIfMissing(...).')
    console.error(`  Driver: ${driver}`)
    process.exit(1)
}

if (!carriesContribution && !sessions.includes('CONTRIBUTION_FIELDS')) {
    console.error('verify-externalrefs-preserve: FAIL — CONTRIBUTION_FIELDS unused')
    process.exit(1)
}

const handlers = read('hub/src/socket/handlers/cli/sessionHandlers.ts')
if (handlers && handlers.includes('stripExternalRefsWhenAwarenessDisabled')) {
    if (!handlers.includes('omitEmptyExternalRefsOnCliMetadataWrite')) {
        console.error('verify-externalrefs-preserve: FAIL')
        console.error('  sessionHandlers strips/gates externalRefs but lacks omitEmptyExternalRefsOnCliMetadataWrite.')
        console.error('  CLI update-metadata with externalRefs: [] must not unlink (use PUT /external-refs).')
        process.exit(1)
    }
}

console.log('verify-externalrefs-preserve: OK (CONTRIBUTION_FIELDS + CLI empty-[] guard)')
process.exit(0)
