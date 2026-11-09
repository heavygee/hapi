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
 *   $HAPI_DRIVER_MANIFEST -> $PRIMARY/config/driver-manifest.yaml
 * No ~/.config fallback — a stale mirror once composed soup on upstream/main
 * after the recipe flipped to origin/main (2026-10-06). Optional mirror script
 * may still write ~/.config for humans; rebuild never reads it by default.
 */
function resolveManifest() {
    const explicit = flag('manifest', null)
    if (explicit) return explicit
    if (process.env.HAPI_DRIVER_MANIFEST) return process.env.HAPI_DRIVER_MANIFEST
    return join(primary, 'config/driver-manifest.yaml')
}
const manifestPath = resolveManifest()
const registryPath = flag('registry', join(primary, 'config/soup-excised.yaml'))
const asJson = has('json')

/**
 * Remat mode, mirroring hapi-driver-rebuild.sh's own $REMAT_MODE.
 *
 * WHY THIS EXISTS (2026-11-09, found by session 3c5af7c8 before it cost anyone
 * a red light): `refCarries` asks `git cat-file -e <ref>:<path>` — does the
 * file EXIST in that layer branch's tree. That is the right question for a
 * full-recipe rebuild, where every layer is merged onto a fresh base and its
 * tree really would reintroduce the file. It is the wrong question for
 * tip-forward, which does not replay layers that are already tip ancestors:
 * their trees never contribute, so a file sitting in them as dead baggage from
 * an old rebase cannot come back.
 *
 * Adding two #1772 entries made the check exit 1 while naming 37 unrelated
 * layers (session-job-progress-until, search-peers, spawn-machine-delta, …)
 * that merely still have the file present. None of them use it. Blocking a
 * tip-forward remat on that is a false red, and "re-thin 37 peers' layers to
 * clear incidental baggage" is not a real remedy.
 *
 * So: in tip-forward, a carrier that is ALREADY A TIP ANCESTOR is reported but
 * does not block; a carrier that is not an ancestor WILL be replayed and still
 * blocks. Full-recipe keeps the exhaustive behaviour, because there the
 * baggage genuinely does come back. Same split the heal step in
 * hapi-driver-rebuild.sh already makes between the two modes.
 */
const rematMode = flag('mode', process.env.HAPI_REMAT_MODE ?? 'full-recipe')
const tipRef = flag('tip', null)

const git = (args) => spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8' })

/** Is `ref` already contained in the tip? Then tip-forward will not replay it. */
function isTipAncestor(ref) {
    if (!tipRef) return false
    const r = git(['rev-list', '--count', ref, `^${tipRef}`])
    return r.status === 0 && r.stdout.trim() === '0'
}

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

const tipForward = rematMode === 'tip-forward' && Boolean(tipRef)
const findings = []
for (const entry of entries) {
    const label = entry.path ?? `symbol:${entry.symbol}`
    const carriers = layers
        .filter((l) => !entry.allow.includes(l))
        .filter((l) => refCarries(l, entry))
    if (carriers.length === 0) continue
    // In tip-forward, an ancestor layer is not replayed, so its copy of the
    // file cannot reach the composed tip. Report it, do not block on it.
    const inert = tipForward ? carriers.filter((c) => isTipAncestor(c)) : []
    const blocking = carriers.filter((c) => !inert.includes(c))
    findings.push({ label, carriers, blocking, inert, reason: entry.reason, ref: entry.ref })
}

const blockingFindings = findings.filter((f) => f.blocking.length > 0)

if (asJson) {
    console.log(JSON.stringify({
        manifest: manifestPath, layers: layers.length, mode: rematMode,
        tip: tipRef, findings
    }, null, 2))
    process.exit(blockingFindings.length > 0 ? 1 : 0)
}

console.log(`hapi-soup-excised-check: ${entries.length} excised item(s) vs ${layers.length} active layer(s)`)
if (tipForward) console.log(`  mode: tip-forward (tip ${tipRef}) — ancestor carriers are not replayed`)

if (findings.length === 0) {
    console.log('  OK — no active layer carries an excised item')
    process.exit(0)
}

// Inert carriers are worth SAYING even when they do not block: silence here
// would be the same "looks covered, wasn't" failure the registry exists to
// prevent. They stop being inert the moment someone runs a full recipe.
for (const f of findings.filter((x) => x.inert.length > 0)) {
    console.log(`\n  present but inert: ${f.label}`)
    console.log(`    ${f.inert.length} carrier(s) are already tip ancestors, so tip-forward will not replay them.`)
    console.log('    They WILL reintroduce it under a full recipe — re-thin or drop them before one.')
}

if (blockingFindings.length === 0) {
    console.log('\n  OK — nothing an excised item is carried by will be replayed into this tip')
    process.exit(0)
}

console.error('hapi-soup-excised-check: FAIL')
for (const f of blockingFindings) {
    console.error(`\n  EXCISED ITEM STILL PRESENT: ${f.label}`)
    if (f.reason) console.error(`    why excised: ${f.reason}`)
    if (f.ref) console.error(`    decision:    ${f.ref}`)
    console.error(`    carried by ${f.blocking.length} layer(s) that WILL be replayed:`)
    for (const c of f.blocking) console.error(`      - ${c}`)
}
console.error(`
  Dropping a manifest layer does NOT remove code that other layers re-carry.
  Re-cut the layers above thin (feature-only) from a clean base, or drop them.
  NOTE: the registry DETECTS, it never removes — land an excision entry WITH or
  AFTER the layer that actually deletes the files, never before, or every
  compose fails on a removal nothing performs.
  See config/soup-excised.yaml and docs/tooling/driver-soup.md.`)
process.exit(1)
