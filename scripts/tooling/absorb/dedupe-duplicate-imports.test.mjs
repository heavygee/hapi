#!/usr/bin/env bun
/**
 * Tests for dedupe-duplicate-imports.
 *
 * The thing under test rewrites source files unattended, so the cases that
 * matter most are the ones where it must REFUSE or do NOTHING. A dedupe tool
 * that quietly drops a binding is far worse than the duplicates it fixes.
 */
import { dedupeImports } from './dedupe-duplicate-imports.mjs'

let pass = 0
let fail = 0
const ok = () => pass++
const bad = (msg) => {
    fail++
    console.error(`FAIL: ${msg}`)
}
const eq = (actual, expected, msg) => (actual === expected ? ok() : bad(`${msg}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`))

// 1. the core case: two type-only imports from one module merge, union order
{
    const src = ["import type { A, B } from 'x'", "import type { B, C } from 'x'", 'const v = 1'].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 1, 'should merge one duplicate line')
    eq(r.text, ["import type { A, B, C } from 'x'", 'const v = 1'].join('\n'), 'union on the first line, dup removed')
    eq(r.refusals.length, 0, 'no refusals expected')
}

// 2. nothing to do -> text returned byte-identical. An "idempotent" tool that
//    reformats on every run makes absorb diffs unreadable.
{
    const src = ["import type { A } from 'x'", "import { b } from 'y'", ''].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'nothing to merge')
    eq(r.text, src, 'unchanged text must be byte-identical')
}

// 3. a type-only and a value import of the SAME module stay separate
{
    const src = ["import type { A } from 'x'", "import { b } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'type-only and value imports must not be collapsed')
    eq(r.text, src, 'both statements preserved')
}

// 4. REFUSE when one local name is bound two different ways
{
    const src = ["import type { Foo } from 'x'", "import type { Foo as Bar, Foo } from 'x'"].join('\n')
    const r = dedupeImports(src)
    // `Foo as Bar` has local `Bar`, `Foo` has local `Foo` — no clash. Use a real clash:
    const src2 = ["import type { Foo as Baz } from 'x'", "import type { Qux as Baz } from 'x'"].join('\n')
    const r2 = dedupeImports(src2)
    eq(r2.refusals.length, 1, 'same local bound from two different names must refuse')
    eq(r2.text, src2, 'refused file must be left byte-identical')
    eq(r2.merged, 0, 'refused file must report zero merges')
    // and the non-clashing alias case still merges correctly
    eq(r.refusals.length, 0, 'distinct locals via alias are not a clash')
}

// 5. aliases with the same source name but different locals are BOTH kept
{
    const src = ["import type { A as B } from 'x'", "import type { A as C } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 1, 'should merge the statements')
    eq(r.text, "import type { A as B, A as C } from 'x'", 'both aliases survive')
}

// 6. default, namespace and side-effect imports are never touched
{
    const src = ["import React from 'react'", "import * as path from 'node:path'", "import './side-effect'", "import Other from 'react'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'non-named import forms are out of scope')
    eq(r.text, src, 'unchanged')
}

// 7. multi-line import blocks are out of scope even when a duplicate exists
{
    const src = ['import {', '    A,', "} from 'x'", "import type { A } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'multi-line blocks must not be rewritten')
    eq(r.text, src, 'unchanged')
}

// 8. inline `type` markers inside a value import are preserved verbatim
{
    const src = ["import { type A, b } from 'x'", "import { c } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.text, "import { type A, b, c } from 'x'", 'inline type marker kept')
}

// 9. three copies collapse to one, not two
{
    const src = ["import type { A } from 'x'", "import type { B } from 'x'", "import type { C } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 2, 'two duplicate lines removed')
    eq(r.text, "import type { A, B, C } from 'x'", 'single merged statement')
}

// 10. different modules are never merged with each other
{
    const src = ["import type { A } from 'x'", "import type { A } from 'y'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'same name from different modules is a real clash, not ours to fix')
    eq(r.text, src, 'unchanged')
}

// 11. quote style of the kept line is preserved (the repo uses single quotes;
//     rewriting to double would fight the formatter on every absorb)
{
    const src = ['import type { A } from "x"', 'import type { B } from "x"'].join('\n')
    const r = dedupeImports(src)
    eq(r.text, 'import type { A, B } from "x"', 'double quotes preserved')
}

// 12. an indented import (inside a comment, template or block) is ignored
{
    const src = ["import type { A } from 'x'", "    import type { B } from 'x'"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 0, 'indented import is not a top-level statement')
    eq(r.text, src, 'unchanged')
}

// 13. trailing semicolons and trailing commas are tolerated
{
    const src = ["import type { A, } from 'x';", "import type { B } from 'x';"].join('\n')
    const r = dedupeImports(src)
    eq(r.merged, 1, 'semicolon/trailing-comma form still merges')
    eq(r.text, "import type { A, B } from 'x'", 'normalised to one statement')
}

// 14. a refusal in ONE module must not silently rewrite the others. All-or-
//     nothing per file: a partial rewrite alongside an error message is how a
//     file gets half-fixed and committed.
{
    const src = ["import type { A } from 'x'", "import type { B } from 'x'", "import type { P as Z } from 'y'", "import type { Q as Z } from 'y'"].join('\n')
    const r = dedupeImports(src)
    eq(r.refusals.length, 1, 'the y-module clash is reported')
    eq(r.text, src, 'the x-module merge must NOT be applied when the file has a refusal')
}

// --- multi-line blocks (opt-in via { multiline: true }) ------------------

// 15. off by default: a multi-line block duplicated by a single-line import is
//     left alone unless the caller opts in.
{
    const src = ['import {', '    A,', '    B', "} from 'x'", "import { C } from 'x'"].join('\n')
    eq(dedupeImports(src).merged, 0, 'multiline must stay opt-in')
    eq(dedupeImports(src).text, src, 'and unchanged')
}

// 16. opted in: the block and the single line merge into one statement
{
    const src = ['import {', '    A,', '    B', "} from 'x'", "import { C } from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 1, 'one duplicate removed')
    eq(r.text, "import {\n    A,\n    B,\n    C\n} from 'x'", 'merged, and the multi-line shape is preserved')
}

// 17. THE REFORMAT GUARD. A multi-line block with no duplicate must come back
//     byte-identical — collapsing it anyway would reformat every multi-line
//     import in the repo on first run.
{
    const src = ['import {', '    A,', '    B', "} from 'x'", "import { C } from 'y'", ''].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 0, 'nothing to merge')
    eq(r.text, src, 'untouched multi-line block is byte-identical')
}

// 18. an untouched block is restored in the RIGHT PLACE when an earlier block
//     did merge. This is the stale-index bug: splicing in place moves later
//     blocks, so a recorded index puts the restored block back wrong.
{
    const src = [
        'import {', '    A', "} from 'x'",
        "import { B } from 'x'",
        'const between = 1',
        'import {', '    KeepMe,', '    AlsoKeep', "} from 'z'",
        'const after = 2',
    ].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 1, 'only the x-module pair merges')
    eq(r.text, [
        'import {', '    A,', '    B', "} from 'x'",
        'const between = 1',
        'import {', '    KeepMe,', '    AlsoKeep', "} from 'z'",
        'const after = 2',
    ].join('\n'), 'the z block is restored verbatim and in place')
}

// 19. a block containing a comment is skipped: the comment belongs to a
//     binding and merging would strand it.
{
    const src = ['import {', '    // the fork needs this one', '    A', "} from 'x'", "import { B } from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 0, 'a commented block is not rewritten')
    eq(r.text, src, 'unchanged')
}

// 20. type-only multi-line stays separate from a value import of the module
{
    const src = ['import type {', '    A', "} from 'x'", "import { b } from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 0, 'type-only and value still never collapse')
    eq(r.text, src, 'unchanged')
}

// 21. two multi-line blocks from the SAME module merge with each other
{
    const src = ['import {', '    A', "} from 'x'", 'import {', '    B', "} from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 1, 'two blocks merge into one')
    eq(r.text, "import {\n    A,\n    B\n} from 'x'", 'merged, shape preserved')
}

// 22. an unterminated `import {` is not treated as a block (it would otherwise
//     swallow the rest of the file)
{
    const src = ['import {', 'const notAnImport = 1', "import { B } from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 0, 'unterminated opener ignored')
    eq(r.text, src, 'unchanged')
}

// 23. trailing comma in a multi-line block is tolerated
{
    const src = ['import {', '    A,', '    B,', "} from 'x'", "import { C } from 'x'"].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.text, "import {\n    A,\n    B,\n    C\n} from 'x'", 'trailing comma handled')
}

// 47. A merge INTO a multi-line block re-emits multi-line. Collapsing it to one
//     line is semantically identical, which is why nothing caught it on
//     overseerEntity.ts — a 39-line block became a single 1,400-char line.
{
    const src = [
        'import {',
        '    Alpha,',
        '    Beta',
        "} from 'x'",
        "import { Gamma } from 'x'",
        'const after = 1',
    ].join('\n')
    const r = dedupeImports(src, { multiline: true })
    eq(r.merged, 1, 'the duplicate module is merged')
    eq(r.text.split('\n').every((l) => l.length < 60), true, 'no mega-line is produced')
    eq(r.text.includes('import {\n'), true, 'still a multi-line block')
    for (const n of ['Alpha', 'Beta', 'Gamma']) {
        eq(r.text.includes(n), true, `${n} survives the merge`)
    }
    eq(r.text.endsWith('const after = 1'), true, 'following code is intact')
}

// 48. A merge into a SINGLE-line block stays single-line.
{
    const r = dedupeImports("import { A } from 'x'\nimport { B } from 'x'\n", { multiline: true })
    eq(r.text.includes('import {\n'), false, 'single-line input stays single-line')
    eq(r.text.includes("import { A, B } from 'x'"), true, 'merged on one line')
}

console.log(`dedupe-duplicate-imports: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
