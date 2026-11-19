#!/usr/bin/env bun
/**
 * Port fork-only top-level definitions from one side of a conflict onto the
 * other, for contract files where picking a side loses exports.
 *
 * Why this exists: on 2026-11-19 the absorb resolved shared/src/apiTypes.ts to
 * the fork side wholesale. The fork side was missing 61 exports upstream had
 * added, every cross-package importer of them broke, and the gate still went
 * green because the tests for the lost code were dropped in the same pass.
 * The correct resolution for a contract file is never "pick a side" — it is
 * base + both sides' additions.
 *
 * This tool does the mechanical half: carry `--carrier` as the file body (the
 * side with more of the shared contract), then append the top-level
 * definitions that exist in `--donor` and not in the carrier, in donor order,
 * with their leading doc comments.
 *
 * It does NOT resolve same-name-different-definition collisions. Those are
 * listed on stderr for a human, because they are behaviour (e.g. fork's
 * AcknowledgeModelErrorRequest keyed by `atTs` vs upstream's by `eventId`).
 *
 * Usage:
 *   bun run port-fork-symbols.mjs --carrier <file> --donor <file> --out <file>
 *   bun run port-fork-symbols.mjs --carrier :3:path --donor :2:path --out f --git <worktree>
 *     (": N :path" forms are read from the git index stages of <worktree>)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
}

const carrierRef = arg('--carrier')
const donorRef = arg('--donor')
const out = arg('--out')
const gitTree = arg('--git')

if (!carrierRef || !donorRef || !out) {
    console.error('usage: port-fork-symbols.mjs --carrier <file|:N:path> --donor <file|:N:path> --out <file> [--git <worktree>]')
    process.exit(2)
}

const read = (ref) => {
    if (/^:\d+:/.test(ref)) {
        if (!gitTree) throw new Error('--git <worktree> required for :N:path refs')
        return execFileSync('git', ['-C', gitTree, 'show', ref], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
    }
    return readFileSync(ref, 'utf8')
}

const EXPORT_RE = /^export\s+(?:declare\s+)?(?:const|let|var|type|interface|function|class|enum)\s+([A-Za-z0-9_$]+)/

/**
 * Split a module into top-level definition chunks. A chunk starts at the first
 * line of its leading comment block (/** ... *\/ or a run of //) and runs to
 * the line before the next chunk's start.
 */
const chunks = (text) => {
    const lines = text.split('\n')
    const starts = []
    for (let i = 0; i < lines.length; i++) {
        const m = EXPORT_RE.exec(lines[i])
        if (!m) continue
        // walk back over a contiguous leading comment block
        let s = i
        let j = i - 1
        if (j >= 0 && lines[j].trimEnd().endsWith('*/')) {
            while (j >= 0 && !lines[j].trimStart().startsWith('/*')) j--
            if (j >= 0) s = j
        } else {
            while (j >= 0 && lines[j].trimStart().startsWith('//')) {
                s = j
                j--
            }
        }
        starts.push({ name: m[1], defLine: i, start: s })
    }
    return starts.map((c, k) => ({
        name: c.name,
        text: lines.slice(c.start, k + 1 < starts.length ? starts[k + 1].start : lines.length).join('\n'),
    }))
}

const carrierText = read(carrierRef)
const donorText = read(donorRef)

const carrierChunks = chunks(carrierText)
const donorChunks = chunks(donorText)
const carrierNames = new Set(carrierChunks.map((c) => c.name))

const port = donorChunks.filter((c) => !carrierNames.has(c.name))
const collisions = donorChunks.filter((c) => {
    if (!carrierNames.has(c.name)) return false
    const mine = carrierChunks.find((x) => x.name === c.name)
    return mine && mine.text.trim() !== c.text.trim()
})

const banner = [
    '',
    '// ---------------------------------------------------------------------------',
    '// Fork-only definitions carried across the upstream absorb.',
    '// Appended rather than interleaved so the diff against upstream stays',
    '// readable and the next absorb can see exactly what is fork-local.',
    '// ---------------------------------------------------------------------------',
    '',
]

writeFileSync(out, `${carrierText.replace(/\s*$/, '\n')}${banner.join('\n')}${port.map((c) => c.text.replace(/\s*$/, '')).join('\n\n')}\n`)

console.log(`ported ${port.length} fork-only definition(s) onto carrier -> ${out}`)
if (port.length) console.log(`  ${port.map((c) => c.name).join(', ')}`)
if (collisions.length) {
    console.error(`\n${collisions.length} name(s) exist on BOTH sides with different definitions — carrier kept, review each:`)
    for (const c of collisions) console.error(`  ${c.name}`)
    console.error('These are behaviour, not text. Check the call sites before accepting the carrier version.')
}
