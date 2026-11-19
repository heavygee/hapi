#!/usr/bin/env bash
# Fixture test for the conservative absorb hunk resolver.
# The point of these cases is that the resolver must LEAVE things alone. A
# bulk transform over conflict regions is what damaged ~34 files on
# 2026-11-19 by stripping braces and commas, so parser correctness and
# refusal-to-guess matter more here than coverage.
#
# Conflict markers are assembled at runtime and never written literally at the
# start of a line in this file. The remat greps the whole tree for a
# line-leading '<<<<<<< ' to decide whether a merge left markers behind, so
# literal fixtures here made every compose believe the working tree still had
# an unresolved conflict — which silently disabled the rerere auto-resolve
# fast path that an 84-layer compose depends on.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOOL="$ROOT/scripts/tooling/absorb/resolve-safe-hunks.mjs"
BUN="${BUN:-bun}"

O='<<<<<<<'
S='======='
T='>>>>>>>'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
git -C "$TMP" config user.email t@example.com
git -C "$TMP" config user.name t

# Stage a fake unmerged entry so `git diff --diff-filter=U` lists the file.
make_unmerged() {
    local rel="$1"
    local blob
    blob=$(git -C "$TMP" hash-object -w "$TMP/$rel")
    git -C "$TMP" update-index --add --cacheinfo "100644,$blob,$rel" 2>/dev/null || true
    git -C "$TMP" update-index --index-info <<EOF
100644 $blob 1	$rel
100644 $blob 2	$rel
100644 $blob 3	$rel
EOF
}

check() {
    local label="$1" expect_file="$2" actual_file="$3"
    if diff -q "$expect_file" "$actual_file" >/dev/null; then
        echo "OK: $label"
    else
        echo "FAIL: $label" >&2
        diff "$expect_file" "$actual_file" >&2 || true
        exit 1
    fi
}

# Case 1: ours is a strict superset -> take ours, structure intact.
{
    printf 'const before = 1\n'
    printf '%s HEAD\n' "$O"
    printf 'export const a = 1\n'
    printf 'export const b = 2\n'
    printf '%s\n' "$S"
    printf 'export const a = 1\n'
    printf '%s origin/main\n' "$T"
    printf 'const after = 2\n'
} > "$TMP/superset.ts"
{
    printf 'const before = 1\n'
    printf 'export const a = 1\n'
    printf 'export const b = 2\n'
    printf 'const after = 2\n'
} > "$TMP/superset.expect"

# Case 2: genuine divergence -> MUST stay conflicted, byte-identical.
{
    printf '%s HEAD\n' "$O"
    printf "export const mode = 'soup'\n"
    printf '%s\n' "$S"
    printf "export const flavour = 'upstream'\n"
    printf '%s origin/main\n' "$T"
} > "$TMP/judge.ts"
cp "$TMP/judge.ts" "$TMP/judge.expect"

# Case 3: brace-bearing superset — the 2026-11-19 corruption shape.
{
    printf 'function f() {\n'
    printf '%s HEAD\n' "$O"
    printf '    const x = {\n        a: 1,\n        b: 2,\n    }\n    return x\n'
    printf '%s\n' "$S"
    printf '    const x = {\n        a: 1,\n    }\n    return x\n'
    printf '%s origin/main\n' "$T"
    printf '}\n'
} > "$TMP/braces.ts"
{
    printf 'function f() {\n'
    printf '    const x = {\n        a: 1,\n        b: 2,\n    }\n    return x\n'
    printf '}\n'
} > "$TMP/braces.expect"

# Case 4: malformed region (no separator) -> copied verbatim, never guessed.
{
    printf '%s HEAD\n' "$O"
    printf 'const dangling = true\n'
} > "$TMP/malformed.ts"
cp "$TMP/malformed.ts" "$TMP/malformed.expect"

for f in superset judge braces malformed; do make_unmerged "$f.ts"; done

"$BUN" run "$TOOL" "$TMP" --apply > "$TMP/out.txt" 2>&1 || { cat "$TMP/out.txt" >&2; exit 1; }

check "ours-superset taken, surrounding lines intact" "$TMP/superset.expect" "$TMP/superset.ts"
check "genuine divergence left conflicted" "$TMP/judge.expect" "$TMP/judge.ts"
check "braces and commas survive a superset take" "$TMP/braces.expect" "$TMP/braces.ts"
check "malformed region untouched" "$TMP/malformed.expect" "$TMP/malformed.ts"

echo "all resolve-safe-hunks cases passed"
