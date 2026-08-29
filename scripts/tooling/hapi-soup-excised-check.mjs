#!/usr/bin/env bun
/**
 * Soup excision gate — run from hapi-driver-rebuild --verify.
 *
 * Catches the "dropped layer, code still present" class of bug: a manifest
 * layer is removed to excise some code, but OTHER active layers independently
 * carry the same code inside their own diffs (because they were cut from a tip
 * that still had it). The drop looks successful and silently achieves nothing.
 *
 * Real instance (2026-08-17 -> 2026-08-27): `feat/a2a-p05-peer-provenance` was
 * dropped to remove the rejected #1473 capability stack. Seven other active
 * layers still carried `hub/src/web/peerCapability.ts`, so every rebuild put it
 * back. Docs said soft-nametag; the hub enforced an HMAC for ten more days.
 *
 * Reads config/soup-excised.yaml and, for each entry, reports which ACTIVE
 * manifest layers still carry it. Exits non-zero if any do.
 *
 * Usage:
 *   bun run hapi-soup-excised-check.mjs [--manifest PATH] [--primary PATH] [--json]
 *   bun run hapi-soup-excised-check.mjs --path hub/src/web/peerCapability.ts
 *       (ad-hoc: check one path/symbol without editing the registry)
 *   bun run hapi-soup-excised-check.mjs --symbol verifyPeerSessionCapability
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const HOME = process.env.HOME ?? ''
const primary = flag('primary', process.env.HAPI_PRIMARY ?? join(HOME, 'coding/hapi'))
/**
 * Manifest precedence MUST mirror scripts/tooling/lib/hapi-manifest-path.sh:
 *   $HAPI_DRIVER_MANIFEST -> $PRIMARY/config/driver-manifest.yaml -> legacy ~/.config/hapi.
 * The tracked config/ copy is CANONICAL; ~/.config/hapi is a legacy override that
 * can be stale. Reading the wrong one makes this gate report a false GREEN while
 * the manifest the rebuild actually uses is contaminated — worse than no gate.
 * (Caught 2026-08-29: the two files differed by 17 lines and one carried a layer
 * the other did not.)
 */
function resolveManifest() {
    const explicit = flag('manifest', null)
    if (explicit) return explicit
    if (process.env.HAPI_DRIVER_MANIFEST) return process.env.HAPI_DRIVER_MANIFEST
    const canonical = join(primary, 'config/driver-manifest.yaml')
    if (existsSync(canonical)) return canonical
    return join(HOME, '.config/hapi/driver-manifest.yaml')
}
const manifestPath = resolveManifest()
const registryPath = flag('registry', join(primary, 'config/soup-excised.yaml'))
const asJson = has('json')

const git = (args) => spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8' })

/**
 * Active manifest layers. Deliberately regex over the YAML rather than pulling a
 * parser dependency — but comment lines are stripped FIRST, because a commented
 * `# - branch: foo` is precisely the "already dropped" case we must not count as
 * active. Getting that backwards would make the check claim contamination that
 * has in fact been removed.
 */
function activeLayers() {
    if (!existsSync(manifestPath)) {
        console.error(`hapi-soup-excised-check: manifest not found: ${manifestPath}`)
        process.exit(2)
    }
    return readFileSync(manifestPath, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .map((line) => line.match(/^\s*-\s*branch:\s*(\S+)/)?.[1])
        .filter(Boolean)
}

/** Registry entries. Minimal block-scalar-aware YAML read; no dependency. */
function registryEntries() {
    if (has('path') || has('symbol')) {
        return [{
            path: flag('path', null),
            symbol: flag('symbol', null),
            reason: 'ad-hoc check (not from registry)',
            allow: [],
        }]
    }
    if (!existsSync(registryPath)) return []
    const entries = []
    let current = null
    for (const raw of readFileSync(registryPath, 'utf8').split('\n')) {
        const line = raw.replace(/\s+$/, '')
        if (/^\s*#/.test(line) || !line.trim()) continue
        const start = line.match(/^\s*-\s+(path|symbol):\s*(\S+)/)
        if (start) {
            if (current) entries.push(current)
            current = { path: null, symbol: null, reason: '', allow: [] }
            current[start[1]] = start[2]
            continue
        }
        if (!current) continue
        const kv = line.match(/^\s+(path|symbol|reason|ref):\s*(.*)$/)
        if (kv && kv[2] && !kv[2].startsWith('>')) current[kv[1]] = kv[2].trim()
        const allow = line.match(/^\s+allow:\s*\[(.*)\]/)
        if (allow) current.allow = allow[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
    if (current) entries.push(current)
    return entries
}

/** Does `ref` carry this entry? Path check is exact; symbol check greps the ref. */
function refCarries(ref, entry) {
    if (entry.path) {
        return git(['cat-file', '-e', `${ref}:${entry.path}`]).status === 0
    }
    if (entry.symbol) {
        const r = git(['grep', '-l', '--fixed-strings', entry.symbol, ref, '--', 'hub/src', 'cli/src', 'shared/src'])
        return r.status === 0 && r.stdout.trim().length > 0
    }
    return false
}

const layers = activeLayers()
const entries = registryEntries()

if (entries.length === 0) {
    console.log('hapi-soup-excised-check: registry empty — nothing to enforce')
    process.exit(0)
}

const findings = []
for (const entry of entries) {
    const label = entry.path ?? `symbol:${entry.symbol}`
    const carriers = layers
        .filter((l) => !entry.allow.includes(l))
        .filter((l) => refCarries(l, entry))
    if (carriers.length > 0) findings.push({ label, carriers, reason: entry.reason, ref: entry.ref })
}

if (asJson) {
    console.log(JSON.stringify({ manifest: manifestPath, layers: layers.length, findings }, null, 2))
    process.exit(findings.length > 0 ? 1 : 0)
}

console.log(`hapi-soup-excised-check: ${entries.length} excised item(s) vs ${layers.length} active layer(s)`)

if (findings.length === 0) {
    console.log('  OK — no active layer carries an excised item')
    process.exit(0)
}

console.error('hapi-soup-excised-check: FAIL')
for (const f of findings) {
    console.error(`\n  EXCISED ITEM STILL PRESENT: ${f.label}`)
    if (f.reason) console.error(`    why excised: ${f.reason}`)
    if (f.ref) console.error(`    decision:    ${f.ref}`)
    console.error(`    carried by ${f.carriers.length} active layer(s):`)
    for (const c of f.carriers) console.error(`      - ${c}`)
}
console.error(`
  Dropping a manifest layer does NOT remove code that other layers re-carry.
  Re-cut the layers above thin (feature-only) from a clean base, or drop them.
  See config/soup-excised.yaml and docs/tooling/driver-soup.md.`)
process.exit(1)
