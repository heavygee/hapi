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

console.log(`dedupe-duplicate-imports: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
