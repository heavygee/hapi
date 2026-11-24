// SWEEP 2 analysis: t('key') references with no definition in the `en` catalogue.
// Run from the repo root. Reports three buckets separately, because conflating
// them is how a sweep produces a number nobody can act on.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.argv[2] ?? '.'
const WEB_SRC = join(ROOT, 'web/src')

// --- the catalogue, flattened to dotted keys -------------------------------
const { en } = await import(join(process.cwd(), ROOT, 'web/src/lib/locales/index.ts'))
const defined = new Set()
const walkCat = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v)) walkCat(v, path)
        else defined.add(path)
    }
}
walkCat(en, '')

// --- every t(...) call site ------------------------------------------------
const files = []
const walkDir = (dir) => {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walkDir(p)
        else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
}
walkDir(WEB_SRC)

// A literal followed by `+` is a CONCATENATED key, not a complete one:
// `t('sessions.search.scope.' + mode + '.description')` would otherwise be
// reported as the undefined key `sessions.search.scope.` — a false positive,
// and a gate that cries wolf is a gate people stop reading. The trailing
// `(?!\s*\+)` is what makes the match mean "this is the whole key".
const STATIC = /\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1(?!\s*\+)/g
const DYNAMIC = /\bt\(\s*(?!['"])[^)]/g
const CONCAT = /\bt\(\s*(['"])[A-Za-z0-9_.-]+\1\s*\+/g

const missing = new Map()   // key -> [sites]
let staticCount = 0
let dynamicCount = 0

for (const file of files) {
    if (/\.test\.(ts|tsx)$/.test(file)) continue   // tests may assert bogus keys deliberately
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(STATIC)) {
        staticCount++
        const key = m[2]
        if (!defined.has(key)) {
            const line = src.slice(0, m.index).split('\n').length
            if (!missing.has(key)) missing.set(key, [])
            missing.get(key).push(`${relative(ROOT, file)}:${line}`)
        }
    }
    dynamicCount += [...src.matchAll(DYNAMIC)].length
}

console.log(`catalogue:      ${defined.size} defined keys in \`en\``)
console.log(`static t()    : ${staticCount} call sites with a literal key`)
console.log(`dynamic t()   : ${dynamicCount} call sites with a non-literal key (NOT checkable)`)
console.log(`undefined keys: ${missing.size}`)
for (const [key, sites] of [...missing].sort()) {
    console.log(`  ${key}`)
    for (const s of sites.slice(0, 4)) console.log(`      ${s}`)
}

// --- locale parity, reported but NOT failed --------------------------------
// Only `en` can produce the bug this tool exists to catch. t() resolves
// `dict[key] ?? locales.en[key] ?? key` (web/src/lib/i18n-context.tsx), so a key
// missing from ru/ja/zh-CN degrades to English PROSE, while a key missing from
// `en` renders the RAW DOTTED KEY on screen. The non-en gaps below are partial
// translation — the designed state — and are printed so nobody later mistakes
// them for absorb losses and "restores" hundreds of strings that were never
// lost. That is why this section reports and does not fail.
const allLocales = await import(join(process.cwd(), ROOT, 'web/src/lib/locales/index.ts'))
console.log('\nlocale parity (informational — only `en` gaps show as raw keys to a user):')
for (const name of ['en', 'zhCN', 'ru', 'ja']) {
    const dict = allLocales[name]
    if (!dict) continue
    const gaps = Object.keys(allLocales.en).filter((k) => !(k in dict)).length
    console.log(`  ${name.padEnd(5)} ${String(Object.keys(dict).length).padStart(5)} keys · ${gaps} missing vs en`)
}

// --- positive control: a key that cannot exist must be reported ------------
const control = 'sweep2.control.definitely-not-a-real-key'
console.log(`\npositive control (${control} defined? ${defined.has(control)}) -> ${defined.has(control) ? 'PROBE BROKEN' : 'probe can detect absence'}`)
