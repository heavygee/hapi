#!/usr/bin/env bun
/**
 * Soup base-completeness gate.
 *
 * 2026-11-19: a 110-commit absorb promoted a tip that was missing 209 of the
 * 293 files upstream had added — 163 absent outright, 46 present but ZERO
 * BYTES — plus 61 exported symbols dropped from shared/src/apiTypes.ts. The
 * full gate reported EXIT=0: hub 2357 pass / 0 fail, web 4776, typecheck
 * clean. It passed *because* each lost implementation file had its test file
 * emptied or dropped in the same resolution pass. Nothing was left to fail.
 *
 * The cause was applying "soup wins overlapping edits" to files where
 * upstream was ADDING exports. An addition has no overlap, so soup-wins is
 * not a tie-break there — it is silent deletion. tsc cannot see it either:
 * an empty .ts is a legal module, and a dropped file with no importer on the
 * fork side is simply absent.
 *
 * Rule: the composed tip merges the base ref, so every source file in the
 * base must be present and non-empty in the tip unless explicitly allowed.
 *
 * Usage: bun run hapi-soup-base-completeness-check.mjs [remat-or-driver-dir]
 *   HAPI_SOUP_BASE_REF   base to compare against (default origin/main)
 * Wired into hapi-driver-rebuild after heals, before promote (always — a
 * deletion this size must not wait for someone to pass --verify).
 *
 * Allowlist (absence and symbol loss only — never zero-byte):
 *   config/soup-base-completeness-allow.txt, one path or path#SYMBOL per
 *   line, '#' at line start comments. A layer that deliberately deletes an
 *   upstream file belongs here, with a reason on the comment line above it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const tree = process.argv[2] ?? process.env.HAPI_DRIVER ?? join(process.env.HOME ?? '', 'coding/hapi/driver')
const baseRef = process.env.HAPI_SOUP_BASE_REF ?? 'origin/main'

/** Source roots that carry shipped code. Docs/artefacts are intentionally out of scope. */
const ROOTS = ['shared/src', 'relay/src', 'hub/src', 'cli/src', 'web/src']

/**
 * Contract files whose exports other packages import by name. Symbol loss
 * here is what made the 2026-11-19 file restore unfixable: the files came
 * back, their types did not, and the restore produced 577 tsc errors.
 */
const CONTRACT_FILES = [
    'shared/src/apiTypes.ts',
    'shared/src/index.ts',
    'shared/src/rpcMethods.ts',
    'web/src/api/client.ts',
]

const git = (...args) =>
    execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 })

const allowPath = join(tree, 'config/soup-base-completeness-allow.txt')
const allowed = new Set(
    existsSync(allowPath)
        ? readFileSync(allowPath, 'utf8')
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith('#'))
        : []
)

const isSource = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts')

/** `git ls-tree -r --long` → Map<path, bytes> for the source roots only. */
const treeSizes = (ref) => {
    const out = git('ls-tree', '-r', '--long', ref, '--', ...ROOTS)
    const sizes = new Map()
    for (const line of out.split('\n')) {
        if (!line) continue
        // <mode> <type> <oid> <size>\t<path>  — size is right-padded
        const tab = line.indexOf('\t')
        if (tab < 0) continue
        const path = line.slice(tab + 1)
        const size = Number(line.slice(0, tab).trim().split(/\s+/)[3])
        if (isSource(path)) sizes.set(path, size)
    }
    return sizes
}

const exportsOf = (ref, path) => {
    let src
    try {
        src = git('show', `${ref}:${path}`)
    } catch {
        return null
    }
    const names = new Set()
    for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|type|interface|function|class|enum)\s+([A-Za-z0-9_$]+)/g)) {
        names.add(m[1])
    }
    return names
}

let baseSizes
try {
    baseSizes = treeSizes(baseRef)
} catch {
    console.error(`soup-base-completeness: cannot read ${baseRef} in ${tree} — skipping (fetch it first to enable this gate)`)
    process.exit(0)
}
const tipSizes = treeSizes('HEAD')

/**
 * Absence and symbol loss only mean DAMAGE on a tip that has actually merged
 * the base. On a tip that simply has not absorbed yet, everything the base
 * gained since is legitimately absent — comparing there would fail every
 * honest pre-absorb promote. Zero-byte needs no such qualifier: it is never
 * legitimate regardless of ancestry.
 */
let absorbed = false
try {
    execFileSync('git', ['-C', tree, 'merge-base', '--is-ancestor', baseRef, 'HEAD'], { stdio: 'ignore' })
    absorbed = true
} catch {
    absorbed = false
}

const zero = []
for (const [path, size] of tipSizes) if (size === 0) zero.push(path)

const missing = []
const symbolLoss = []
if (absorbed) {
    for (const path of baseSizes.keys()) if (!tipSizes.has(path) && !allowed.has(path)) missing.push(path)

    for (const path of CONTRACT_FILES) {
        const before = exportsOf(baseRef, path)
        const after = exportsOf('HEAD', path)
        if (!before || !after) continue
        for (const name of before) {
            if (!after.has(name) && !allowed.has(`${path}#${name}`)) symbolLoss.push(`${path}#${name}`)
        }
    }
}

const sample = (list, n = 15) =>
    list
        .slice(0, n)
        .map((p) => `    ${p}`)
        .concat(list.length > n ? [`    ... and ${list.length - n} more`] : [])
        .join('\n')

let failed = false

if (zero.length) {
    failed = true
    console.error(`\nFAIL: ${zero.length} tracked source file(s) are ZERO BYTES on the tip.`)
    console.error('      An empty .ts is a legal module, so tsc and the test gate both pass it.')
    console.error('      There is no legitimate reason for an empty source file — not allowlistable.')
    console.error(sample(zero))
}

if (missing.length) {
    failed = true
    console.error(`\nFAIL: ${missing.length} source file(s) present in ${baseRef} are absent from the tip.`)
    console.error('      The tip merges the base, so absence means a resolution dropped them.')
    console.error('      Upstream ADDITIONS are never a soup-wins tie-break — take them.')
    console.error(sample(missing))
}

if (symbolLoss.length) {
    failed = true
    console.error(`\nFAIL: ${symbolLoss.length} exported symbol(s) in ${baseRef} contract files are gone from the tip.`)
    console.error('      Importers across packages resolve these by name; losing them breaks')
    console.error('      consumers that the composed tip does not itself compile.')
    console.error(sample(symbolLoss))
}

if (failed) {
    console.error('\nRemediation: re-resolve against the base taking upstream additions in full')
    console.error('(soup wins only genuine same-line conflicts), or, for a deliberate layer')
    console.error(`deletion, add the path to config/soup-base-completeness-allow.txt with a reason.`)
    console.error(`Compared: HEAD=${git('rev-parse', '--short', 'HEAD').trim()} base=${baseRef}\n`)
    process.exit(1)
}

console.log(
    absorbed
        ? `soup-base-completeness OK: ${tipSizes.size} source files, none empty, none missing vs ${baseRef}, contract exports intact`
        : `soup-base-completeness OK: ${tipSizes.size} source files, none empty (${baseRef} not yet merged into this tip — absence/symbol checks not applicable)`
)
