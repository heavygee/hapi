#!/usr/bin/env bun
/**
 * Conservative conflict-hunk resolver for soup absorbs.
 *
 * Context: the 2026-11-19 absorb lost 209 upstream-added files and 61 apiTypes
 * exports because bulk transforms were applied to conflict regions — a blunt
 * line-union stripped braces and commas across ~34 files, and file-level
 * "soup wins" deleted upstream additions outright. So this tool refuses to be
 * clever. It resolves ONLY hunks where one side provably contains the other,
 * and leaves every hunk needing judgement untouched for a human.
 *
 * Safe cases:
 *   superset  one side's non-blank trimmed line multiset contains all of the
 *             other's -> take the containing side. No line present on either
 *             side is lost, which is exactly the property the 2026-11-19
 *             damage violated.
 *   reorder   both sides have identical line multisets in a different order
 *             -> take ours (soup); ordering is not behaviour.
 *
 * Everything else is left conflicted on purpose — including import blocks
 * where one side adds symbols to a rewritten line. An import union looks safe
 * and is not: `import type` and value imports do not merge by text.
 *
 * Usage: bun run resolve-safe-hunks.mjs <worktree> [--apply]
 * Default is a dry run. Nothing is staged; run the completeness gate and
 * typecheck after applying.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const tree = process.argv[2]
const apply = process.argv.includes('--apply')
if (!tree) {
    console.error('usage: resolve-safe-hunks.mjs <worktree> [--apply]')
    process.exit(2)
}

const conflicted = execFileSync('git', ['-C', tree, 'diff', '--name-only', '--diff-filter=U'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
})
    .split('\n')
    .filter(Boolean)

const norm = (lines) => lines.map((l) => l.trim()).filter(Boolean)
const key = (lines) => norm(lines).sort().join('\n')

/** multiset containment over trimmed non-blank lines */
const contains = (big, small) => {
    const counts = new Map()
    for (const l of norm(big)) counts.set(l, (counts.get(l) ?? 0) + 1)
    for (const l of norm(small)) {
        const n = counts.get(l) ?? 0
        if (n === 0) return false
        counts.set(l, n - 1)
    }
    return true
}

const stats = { files: 0, fullyClean: 0, superset: 0, reorder: 0, left: 0 }
const report = []

for (const rel of conflicted) {
    const path = join(tree, rel)
    let text
    try {
        text = readFileSync(path, 'utf8')
    } catch {
        continue
    }
    if (!text.includes('<<<<<<<')) continue
    stats.files++

    const lines = text.split('\n')
    const out = []
    let i = 0
    let resolvedHere = 0
    let leftHere = 0

    while (i < lines.length) {
        if (!lines[i].startsWith('<<<<<<<')) {
            out.push(lines[i++])
            continue
        }
        const start = i
        const ours = []
        const theirs = []
        i++
        while (i < lines.length && !lines[i].startsWith('=======') && !lines[i].startsWith('<<<<<<<')) ours.push(lines[i++])
        if (i >= lines.length || !lines[i].startsWith('=======')) {
            out.push(...lines.slice(start, i)) // malformed: copy verbatim, never guess
            continue
        }
        const sepLine = lines[i]
        i++
        while (i < lines.length && !lines[i].startsWith('>>>>>>>') && !lines[i].startsWith('<<<<<<<')) theirs.push(lines[i++])
        if (i >= lines.length || !lines[i].startsWith('>>>>>>>')) {
            out.push(...lines.slice(start, i))
            continue
        }
        const endLine = lines[i]
        i++

        if (key(ours) === key(theirs)) {
            out.push(...ours)
            stats.reorder++
            resolvedHere++
        } else if (contains(ours, theirs)) {
            out.push(...ours)
            stats.superset++
            resolvedHere++
        } else if (contains(theirs, ours)) {
            out.push(...theirs)
            stats.superset++
            resolvedHere++
        } else {
            out.push(lines[start], ...ours, sepLine, ...theirs, endLine)
            stats.left++
            leftHere++
        }
    }

    if (resolvedHere === 0) continue
    report.push(`  ${rel}: resolved ${resolvedHere}, left ${leftHere}`)
    if (leftHere === 0) stats.fullyClean++
    if (apply) writeFileSync(path, out.join('\n'))
}

console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — conflicted files scanned: ${stats.files}`)
console.log(`  hunks resolved as superset : ${stats.superset}`)
console.log(`  hunks resolved as reorder  : ${stats.reorder}`)
console.log(`  hunks left for judgement   : ${stats.left}`)
console.log(`  files left with no markers : ${stats.fullyClean}`)
if (report.length) console.log(report.slice(0, 20).join('\n'))
if (!apply) console.log('\nre-run with --apply to write; then typecheck + the completeness gate')
