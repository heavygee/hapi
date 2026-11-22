#!/usr/bin/env bun
/**
 * Did this resolution keep what BOTH sides added?
 *
 * Why this exists: on 2026-11-19 an absorb resolved 258 files, passed its gate,
 * and had silently dropped 209 files and 61 exports. Typecheck cannot see that
 * class of loss (nothing breaks when a feature stops being offered) and neither
 * can tests (the tests for the lost code were dropped in the same pass). The
 * only mechanical check is: for each conflicted file, take the identifiers each
 * side ADDED relative to the merge base, and assert they survived.
 *
 * ADDED RELATIVE TO BASE — this is the whole correctness of the tool. An
 * earlier version of this check compared `upstream - fork`, which reported 56
 * "lost upstream identifiers" in web/src/components/SessionList.tsx. Thirteen
 * of them (LEGACY_LIST_ORDER, listComparator, renderNewSessionInGroupButton,
 * soleRegisteredMachine, …) were in the BASE with upstream's exact count and
 * absent from the fork: the fork had deliberately DELETED them and upstream had
 * simply not touched them. Honouring a deliberate deletion is correct, and a
 * tool that calls it a loss trains you to re-add code the fork removed on
 * purpose. Only `side - base` is an addition.
 *
 * The converse still holds and is the real finding: an identifier a side added
 * which is absent from the resolution is either a loss or a deliberate
 * supersession, and the operator has to say which. So the exit code is advisory
 * by default and only hard-fails under --strict.
 *
 * Identifiers, not AST symbols, deliberately: a JSX section, a tool name in a
 * string literal, a locale key and a middleware call are all invisible to a
 * symbol-level diff, and every one of those has been lost in a real absorb.
 * Comment lines are excluded — prose that names a function it is deleting is
 * the dominant false positive (see hapi-sentinel-check's header).
 *
 * Usage:
 *   presence-audit.mjs --base <ref> --ours <ref> --theirs <ref> --resolved <path> [--git <wt>]
 *   presence-audit.mjs --base :1:<p> --ours :2:<p> --theirs :3:<p> --resolved <p> --git <wt>
 *   presence-audit.mjs --files a.ts,b.ts --base <sha> --ours <sha> --theirs <sha> --git <wt>
 *
 * Exit: 0 nothing lost (or advisory mode) · 1 losses found under --strict · 2 usage.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const arg = (name, dflt) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : dflt
}
const has = (name) => process.argv.includes(name)

const gitTree = arg('--git', '.')
const strict = has('--strict')

const KEYWORDS = new Set(`const let var function class type interface enum export import from return if
else for while switch case break continue new await async of in as default true false null undefined
this void never unknown string number boolean object symbol bigint any readonly keyof typeof extends
implements public private protected static get set yield delete instanceof do try catch finally throw`
    .split(/\s+/).filter(Boolean))

const read = (ref) => {
    if (/^[0-9a-f]{7,40}:/.test(ref) || /^:\d+:/.test(ref) || ref.includes(':')) {
        try {
            return execFileSync('git', ['-C', gitTree, 'show', ref], { encoding: 'utf8', maxBuffer: 1 << 28 })
        } catch {
            return null // the path may not exist on that side; that is itself data
        }
    }
    try { return readFileSync(ref, 'utf8') } catch { return null }
}

/**
 * Identifiers on code lines. Comments excluded: prose naming a deleted helper
 * is the top false positive.
 *
 * Block-comment state is tracked rather than matching line prefixes. Prefix
 * matching alone let continuation lines through whenever they did not start
 * with `*` — a wrapped sentence inside a doc comment contributed `residency`,
 * `heartbeat`, `carries`, `drawn` and about fifteen more to one real audit,
 * which is 20 of 35 findings being English words. Signal that noisy stops
 * being read, which is the failure mode this whole tool exists to avoid.
 */
export const identifiers = (text) => {
    const out = new Set()
    if (!text) return out
    let inBlock = false
    for (const rawLine of text.split('\n')) {
        let line = rawLine
        if (inBlock) {
            const close = line.indexOf('*/')
            if (close === -1) continue
            line = line.slice(close + 2)
            inBlock = false
        }
        // Strip whole inline block comments first, so a `//` INSIDE one cannot
        // be mistaken for a line comment.
        line = line.replace(/\/\*[\s\S]*?\*\//g, ' ')
        // Then honour whichever of `/*` and `//` comes FIRST. Order matters and
        // getting it wrong is not a small error: this used to test for `/*`
        // before stripping line comments, so a line comment that merely
        // MENTIONED one — `// regardless of which \`/sessions/*\` child matched`
        // in web/src/router.tsx — set inBlock and swallowed the entire rest of
        // the file. 338 lines of router.tsx were invisible, including
        // createAppRouter and normalizeRouterBasepath, and the audit reported
        // them as LOST. A false positive wastes a few minutes; this was also a
        // false NEGATIVE for every real loss below the trigger line, in every
        // file with that shape, and a check that silently stops reading is the
        // exact failure this tool exists to prevent.
        const open = line.indexOf('/*')
        // `://` is not a line comment — otherwise any URL in a string truncates
        // the line and drops the identifiers after it.
        let lineComment = -1
        for (let i = line.indexOf('//'); i !== -1; i = line.indexOf('//', i + 1)) {
            if (i === 0 || line[i - 1] !== ':') { lineComment = i; break }
        }
        if (open !== -1 && (lineComment === -1 || open < lineComment)) {
            inBlock = true
            line = line.slice(0, open)
        } else if (lineComment !== -1) {
            line = line.slice(0, lineComment)
        }
        const s = line.trim()
        if (!s) continue
        for (const m of line.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{3,}\b/g)) {
            const id = m[0]
            if (KEYWORDS.has(id)) continue
            if (/^[0-9a-f]*[0-9][0-9a-f]*$/.test(id)) continue // hex-ish: UUID halves in fixtures
            out.add(id)
        }
    }
    return out
}

export const auditOne = ({ base, ours, theirs, resolved }) => {
    const b = identifiers(base)
    const o = identifiers(ours)
    const t = identifiers(theirs)
    const r = identifiers(resolved)
    // An ADDITION is `side - base`. Anything the base already had and a side
    // dropped is that side's deletion, which the resolution may honour.
    const ourAdds = [...o].filter((x) => !b.has(x))
    const theirAdds = [...t].filter((x) => !b.has(x))
    return {
        lostOurs: ourAdds.filter((x) => !r.has(x)).sort(),
        lostTheirs: theirAdds.filter((x) => !r.has(x)).sort(),
        ourAddCount: ourAdds.length,
        theirAddCount: theirAdds.length,
    }
}

/**
 * File-level audit: which files does either parent have that the resolution
 * does not?
 *
 * This exists because the identifier audit above cannot see a file that is
 * simply gone — and because my first attempt at this check LIED. It compared
 * `side - base` plus `fork & theirs` and reported "0 files owed" on a tree that
 * was missing 53 of them. A positive control (spike three known-missing files
 * back out, see whether the probe names them) scored 0 of 3: every real loss
 * was in the BASE and deleted by ONE side, which all three predicates miss by
 * construction.
 *
 * So the predicate is the only one that cannot be fooled: present in EITHER
 * parent, absent here. The results are then CLASSIFIED rather than acted on,
 * because "in base, kept by one side, deleted by the other" is genuinely
 * ambiguous — honouring a deliberate deletion is correct, and bulk-reviving
 * code a side removed on purpose is its own bug.
 *
 * `orphanTests` is the one class that is never ambiguous and never visible any
 * other way: a test file that is absent while its implementation is still
 * present here. Nothing imports a test, so the compiler, the test run and the
 * gate all stay silent while the subject ships with its coverage deleted.
 */
export const auditTrees = ({ base, fork, theirs, resolved }) => {
    const inEither = new Set([...fork, ...theirs])
    const absent = [...inEither].filter((p) => !resolved.has(p)).sort()

    const classify = (p) => {
        const b = base.has(p), f = fork.has(p), t = theirs.has(p)
        if (!b && f && !t) return 'forkAdded'
        if (!b && t && !f) return 'theirsAdded'
        if (b && f && t) return 'keptByBoth'
        if (b && f && !t) return 'theirsDeleted'
        if (b && t && !f) return 'forkDeleted'
        return 'other'
    }

    const classes = { forkAdded: [], theirsAdded: [], keptByBoth: [], theirsDeleted: [], forkDeleted: [], other: [] }
    for (const p of absent) classes[classify(p)].push(p)

    // A test whose subject is still here. Unambiguous, and invisible otherwise.
    const orphanTests = absent
        .filter((p) => /\.test\.(ts|tsx)$/.test(p))
        .map((p) => {
            const stem = p.replace(/\.test\.(ts|tsx)$/, '')
            const impl = ['.ts', '.tsx'].map((e) => stem + e).find((c) => resolved.has(c))
            return impl ? { test: p, impl, side: fork.has(p) ? 'fork' : 'theirs' } : null
        })
        .filter(Boolean)

    // Definite losses: an addition by either side that simply is not here, and
    // anything both sides agreed to keep.
    const definite = [...classes.forkAdded, ...classes.theirsAdded, ...classes.keptByBoth].sort()
    return { absent, classes, orphanTests, definite }
}

if (import.meta.main) {
    // --trees: file-level audit across the two merge parents.
    if (has('--trees')) {
        const baseRef = arg('--base')
        const forkRef = arg('--ours')
        const theirsRef = arg('--theirs')
        if (!baseRef || !forkRef || !theirsRef) {
            console.error('usage: presence-audit.mjs --trees --base <ref> --ours <ref> --theirs <ref> [--git <wt>] [--strict]')
            process.exit(2)
        }
        const lsTree = (ref) => new Set(
            execFileSync('git', ['-C', gitTree, 'ls-tree', '-r', '--name-only', ref],
                { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean))
        // Untracked files count as present: during an absorb the restored files
        // are not staged yet, and calling them missing would be a false alarm.
        // `--untracked-files=all` is required — plain `git status` reports a NEW
        // DIRECTORY as one entry, which hid every file inside it.
        const statusLines = execFileSync('git', ['-C', gitTree, 'status', '--porcelain', '--untracked-files=all'],
            { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)
        const untracked = statusLines.filter((l) => l.startsWith('??')).map((l) => l.slice(3))
        const resolved = new Set([...lsTree('HEAD'), ...untracked])

        const r = auditTrees({ base: lsTree(baseRef), fork: lsTree(forkRef), theirs: lsTree(theirsRef), resolved })
        const label = {
            forkAdded: 'added by ours, absent here      (LOSS)',
            theirsAdded: 'added by theirs, absent here    (LOSS)',
            keptByBoth: 'kept by BOTH, absent here       (LOSS)',
            theirsDeleted: 'in base, ours kept / theirs deleted (review)',
            forkDeleted: 'in base, theirs kept / ours deleted (review)',
            other: 'unclassified                    (review)',
        }
        for (const [k, v] of Object.entries(r.classes)) {
            if (!v.length) continue
            console.log(`${label[k]}: ${v.length}`)
            for (const p of v.slice(0, 20)) console.log(`      ${p}`)
            if (v.length > 20) console.log(`      ... and ${v.length - 20} more`)
        }
        if (r.orphanTests.length) {
            console.log('')
            console.log(`ORPHANED TESTS — implementation still ships, test is gone: ${r.orphanTests.length}`)
            console.log('  Nothing imports a test file, so neither the compiler nor the test run')
            console.log('  can notice these. They are never ambiguous.')
            for (const o of r.orphanTests) console.log(`      ${o.test}   (impl ${o.impl}, from ${o.side})`)
        }
        console.log('')
        console.log(`tree audit: ${r.absent.length} path(s) absent · ${r.definite.length} definite loss(es) · ${r.orphanTests.length} orphaned test(s)`)
        const fatal = r.definite.length + r.orphanTests.length
        process.exit(fatal && strict ? 1 : 0)
    }

    const baseRef = arg('--base')
    const oursRef = arg('--ours')
    const theirsRef = arg('--theirs')
    const resolvedRef = arg('--resolved')
    const files = (arg('--files') || '').split(',').map((s) => s.trim()).filter(Boolean)

    if (!baseRef || !oursRef || !theirsRef || (!resolvedRef && !files.length)) {
        console.error('usage: presence-audit.mjs --base <ref> --ours <ref> --theirs <ref> (--resolved <path> | --files a,b) [--git <wt>] [--strict]')
        process.exit(2)
    }

    const targets = files.length
        ? files.map((f) => ({
            label: f,
            base: read(`${baseRef}:${f}`),
            ours: read(`${oursRef}:${f}`),
            theirs: read(`${theirsRef}:${f}`),
            resolved: read(f),
        }))
        : [{
            label: resolvedRef,
            base: read(baseRef),
            ours: read(oursRef),
            theirs: read(theirsRef),
            resolved: read(resolvedRef),
        }]

    let lost = 0
    for (const target of targets) {
        if (target.resolved === null) {
            console.error(`MISSING  ${target.label} — the resolution has no such file`)
            lost++
            continue
        }
        const r = auditOne(target)
        const n = r.lostOurs.length + r.lostTheirs.length
        if (!n) {
            console.log(`ok       ${target.label}  (${r.ourAddCount} + ${r.theirAddCount} additions, all present)`)
            continue
        }
        lost += n
        console.log(`REVIEW   ${target.label}`)
        if (r.lostOurs.length) console.log(`         ours added, absent from the resolution (${r.lostOurs.length}): ${r.lostOurs.join(', ')}`)
        if (r.lostTheirs.length) console.log(`         theirs added, absent from the resolution (${r.lostTheirs.length}): ${r.lostTheirs.join(', ')}`)
    }

    console.log('')
    console.log(`presence audit: ${targets.length} file(s), ${lost} identifier(s) to account for`)
    if (lost) {
        console.log('Each one is either a LOSS or a deliberate supersession — say which, in the')
        console.log('commit message. This check cannot tell them apart; only you can.')
    }
    process.exit(lost && strict ? 1 : 0)
}
