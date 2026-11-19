#!/usr/bin/env bash
# Regression tests for union-resolve.py.
#
# This tool is the sanctioned mechanical resolver for soup absorbs, and it had
# no tests. Two of its comments record passes where a misclassification
# silently did nothing (pure-addition hunks sitting in MANUAL; ADDITIVE_UNION
# classified but unhandled), which is exactly the class of bug tests catch.
#
# The cases that matter most are the REFUSALS. On 2026-11-19 an absorb lost 209
# upstream-added files and 61 apiTypes exports, partly because bulk transforms
# were trusted over conflict regions. A resolver that takes a side when it
# should not is worse than one that resolves nothing.
#
# Conflict markers are assembled at runtime and never appear at the start of a
# line in this file: the remat greps the tree for a line-leading marker to
# decide whether a merge leaked one, and literal fixtures here would make every
# compose believe the tree still had an unresolved conflict.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOOL="$ROOT/scripts/tooling/absorb/union-resolve.py"
PY="${PYTHON:-python3}"

O='<<<<<<<'
S='======='
T='>>>>>>>'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# conflict <file> <ours-lines...> -- <theirs-lines...>
conflict() {
    local f="$1"; shift
    local side=ours
    : > "$f"
    printf '%s HEAD\n' "$O" >> "$f"
    for line in "$@"; do
        if [[ "$line" == "--" ]]; then
            printf '%s\n' "$S" >> "$f"
            side=theirs
            continue
        fi
        printf '%s\n' "$line" >> "$f"
    done
    printf '%s origin/main\n' "$T" >> "$f"
}

has_markers() { grep -qE "^($O|$T)" "$1"; }

expect_contains() {
    local f="$1" needle="$2" label="$3"
    if grep -qF "$needle" "$f"; then
        echo "OK: $label"
    else
        echo "FAIL: $label (missing: $needle)" >&2
        cat "$f" >&2
        exit 1
    fi
}

expect_resolved() {
    local f="$1" label="$2"
    if has_markers "$f"; then
        echo "FAIL: $label — still conflicted" >&2
        cat "$f" >&2
        exit 1
    fi
    echo "OK: $label"
}

expect_manual() {
    local f="$1" label="$2"
    if has_markers "$f"; then
        echo "OK: $label"
    else
        echo "FAIL: $label — resolver took a side it should have refused" >&2
        cat "$f" >&2
        exit 1
    fi
}

run() { "$PY" "$TOOL" --apply "$@" >/dev/null; }

# 1. Pure addition, ours empty -> take theirs. Nothing can be dropped.
conflict "$TMP/add-theirs.ts" -- "export const added = 1"
run "$TMP/add-theirs.ts"
expect_resolved "$TMP/add-theirs.ts" "pure addition (ours empty) resolved"
expect_contains "$TMP/add-theirs.ts" "export const added = 1" "pure addition kept theirs"

# 2. Pure addition, theirs empty -> take ours. This is the fork-side case: an
#    upstream branch that simply predates a fork block must not delete it.
conflict "$TMP/add-ours.ts" "export const forkOnly = 1" --
run "$TMP/add-ours.ts"
expect_resolved "$TMP/add-ours.ts" "pure addition (theirs empty) resolved"
expect_contains "$TMP/add-ours.ts" "export const forkOnly = 1" "fork-only block survived"

# 3. REFUSAL: both sides declare the same name with different bodies. Identifier
#    sets are identical here, so any containment rule would silently pick one.
conflict "$TMP/same-name.ts" \
    "export function pick() { return 1 }" -- \
    "export function pick() { return 2 }"
run "$TMP/same-name.ts"
expect_manual "$TMP/same-name.ts" "competing implementations of one name refused"

# 4. Additive union: self-contained blocks declaring different things.
conflict "$TMP/additive.ts" \
    "export function aa() { return 1 }" -- \
    "export function bb() { return 2 }"
run "$TMP/additive.ts"
expect_resolved "$TMP/additive.ts" "additive union resolved"
expect_contains "$TMP/additive.ts" "function aa()" "additive union kept ours"
expect_contains "$TMP/additive.ts" "function bb()" "additive union kept theirs"

# 5. Import union: both sides import, result is deduped.
conflict "$TMP/imports.ts" \
    "import { a } from './a'" "import { shared } from './s'" -- \
    "import { b } from './b'" "import { shared } from './s'"
run "$TMP/imports.ts"
expect_resolved "$TMP/imports.ts" "import union resolved"
expect_contains "$TMP/imports.ts" "from './a'" "import union kept ours"
expect_contains "$TMP/imports.ts" "from './b'" "import union kept theirs"
if [[ "$(grep -c "from './s'" "$TMP/imports.ts")" != "1" ]]; then
    echo "FAIL: import union duplicated a shared import" >&2
    exit 1
fi
echo "OK: import union deduped the shared import"

# 6. REFUSAL: an unbalanced fragment must never be concatenated, even though the
#    two sides declare different names. This is the brace/comma corruption shape.
conflict "$TMP/unbalanced.ts" \
    "export function cc() {" -- \
    "export function dd() { return 2 }"
run "$TMP/unbalanced.ts"
expect_manual "$TMP/unbalanced.ts" "unbalanced fragment refused"

# 7. Identifier containment on non-declaration lines (object fields): ours holds
#    every identifier theirs has, plus more -> take ours, braces intact.
conflict "$TMP/fields.ts" \
    "    alpha: 1," "    beta: 2," -- \
    "    alpha: 1,"
run "$TMP/fields.ts"
expect_resolved "$TMP/fields.ts" "field superset resolved"
expect_contains "$TMP/fields.ts" "beta: 2," "field superset kept the extra field"

echo "all union-resolve cases passed"
