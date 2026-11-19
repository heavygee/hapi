#!/usr/bin/env bash
# Fixture test for the conservative absorb hunk resolver.
# The point of these cases is that the resolver must LEAVE things alone. A
# bulk transform over conflict regions is what damaged ~34 files on
# 2026-11-19 by stripping braces and commas, so parser correctness and
# refusal-to-guess matter more here than coverage.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOOL="$ROOT/scripts/tooling/absorb/resolve-safe-hunks.mjs"
BUN="${BUN:-bun}"

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
cat > "$TMP/superset.ts" <<'EOF'
const before = 1
<<<<<<< HEAD
export const a = 1
export const b = 2
=======
export const a = 1
>>>>>>> origin/main
const after = 2
EOF
cat > "$TMP/superset.expect" <<'EOF'
const before = 1
export const a = 1
export const b = 2
const after = 2
EOF

# Case 2: genuine divergence -> MUST stay conflicted, byte-identical.
cat > "$TMP/judge.ts" <<'EOF'
<<<<<<< HEAD
export const mode = 'soup'
=======
export const flavour = 'upstream'
>>>>>>> origin/main
EOF
cp "$TMP/judge.ts" "$TMP/judge.expect"

# Case 3: brace-bearing superset — the 2026-11-19 corruption shape.
cat > "$TMP/braces.ts" <<'EOF'
function f() {
<<<<<<< HEAD
    const x = {
        a: 1,
        b: 2,
    }
    return x
=======
    const x = {
        a: 1,
    }
    return x
>>>>>>> origin/main
}
EOF
cat > "$TMP/braces.expect" <<'EOF'
function f() {
    const x = {
        a: 1,
        b: 2,
    }
    return x
}
EOF

# Case 4: malformed region (no separator) -> copied verbatim, never guessed.
cat > "$TMP/malformed.ts" <<'EOF'
<<<<<<< HEAD
const dangling = true
EOF
cp "$TMP/malformed.ts" "$TMP/malformed.expect"

for f in superset judge braces malformed; do make_unmerged "$f.ts"; done

"$BUN" run "$TOOL" "$TMP" --apply > "$TMP/out.txt" 2>&1 || { cat "$TMP/out.txt" >&2; exit 1; }

check "ours-superset taken, surrounding lines intact" "$TMP/superset.expect" "$TMP/superset.ts"
check "genuine divergence left conflicted" "$TMP/judge.expect" "$TMP/judge.ts"
check "braces and commas survive a superset take" "$TMP/braces.expect" "$TMP/braces.ts"
check "malformed region untouched" "$TMP/malformed.expect" "$TMP/malformed.ts"

echo "all resolve-safe-hunks cases passed"
