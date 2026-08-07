#!/usr/bin/env bun
/**
 * Soup-critical hub route mount gate.
 *
 * Tip-forward remats that touch hub/src/web/server.ts repeatedly drop
 * soup-only mounts (features, upgrade artifact download, inbox/overseer).
 * Heals re-apply them, but tip-forward warn-skips conflicting heals — remat
 * can still go green while /cli/upgrade/cli-artifact falls through to the
 * SPA and fleet-auto toasts "artifact size mismatch: got 5799".
 *
 * Rule: if the route module exists in the tree, server.ts must call the
 * corresponding create*Routes() factory (parens required — import alone fails).
 *
 * Usage: bun run hapi-soup-route-mounts-check.mjs [driver-or-remat-dir]
 * Wired into hapi-driver-rebuild after heals, before promote (always).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const tree = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME ?? '', 'coding/hapi/driver')

/**
 * Soup-only (or soup-fragile) mounts that have been tip-forward casualties.
 * Add a row when a new remount heal lands — do not list upstream-always mounts.
 */
const REQUIRED_IF_MODULE_PRESENT = [
    {
        module: 'hub/src/web/routes/upgrade.ts',
        calls: [
            'createUpgradeCliRoutes()',
            'createUpgradeRoutes(',
        ],
        heal: '100-remount-upgrade-routes.patch',
        why: 'fleet artifact download; missing mount serves SPA index.html as the binary',
    },
    {
        module: 'hub/src/web/routes/features.ts',
        calls: ['createFeaturesRoutes('],
        heal: '99-restore-features-routes-mount.patch',
        why: '/api/features after tip-forward absorb',
    },
    {
        module: 'hub/src/web/routes/systemEvents.ts',
        calls: ['createSystemEventsRoutes('],
        heal: '100-restore-system-events-inbox-overseer-mounts.patch',
        why: 'Session Log / system-events soup surface',
    },
    {
        module: 'hub/src/web/routes/inboxItems.ts',
        calls: ['createInboxItemsRoutes('],
        heal: '100-restore-system-events-inbox-overseer-mounts.patch',
        why: 'inbox items soup surface',
    },
    {
        module: 'hub/src/web/routes/overseer.ts',
        calls: ['createOverseerRoutes('],
        heal: '100-restore-system-events-inbox-overseer-mounts.patch',
        why: 'overseer soup surface',
    },
]

const serverPath = join(tree, 'hub/src/web/server.ts')
if (!existsSync(serverPath)) {
    console.error(`hapi-soup-route-mounts-check: FAIL — missing ${serverPath}`)
    process.exit(1)
}

const server = readFileSync(serverPath, 'utf8')
const failures = []

for (const entry of REQUIRED_IF_MODULE_PRESENT) {
    const modulePath = join(tree, entry.module)
    if (!existsSync(modulePath)) {
        continue
    }
    for (const call of entry.calls) {
        if (!server.includes(call)) {
            failures.push({ ...entry, call })
        }
    }
}

if (failures.length > 0) {
    console.error('hapi-soup-route-mounts-check: FAIL')
    console.error('  hub/src/web/server.ts is missing soup-critical route mount(s):')
    for (const f of failures) {
        console.error(`    - ${f.call}  (module ${f.module} present)`)
        console.error(`      why: ${f.why}`)
        console.error(`      heal: scripts/tooling/soup-heals/${f.heal}`)
    }
    console.error('  Tip-forward likely dropped mounts; re-apply heal or remount before promote.')
    console.error('  Canon: docs/tooling/driver-soup.md § Soup-critical route mounts.')
    process.exit(1)
}

const checked = REQUIRED_IF_MODULE_PRESENT.filter((e) => existsSync(join(tree, e.module))).length
console.log(`hapi-soup-route-mounts-check: OK (${checked} soup-critical module(s) mounted)`)
