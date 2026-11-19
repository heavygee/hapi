#!/usr/bin/env bash
# Smoke-test the soup base-completeness gate (operator-local).
#
# Case 3 is the one that matters most: the first draft of this gate failed the
# live pre-absorb tip, because a tip that has not merged the base yet is
# legitimately missing everything the base gained since. A gate that fails
# honest promotes gets switched off, and then it protects nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/tooling/hapi-soup-base-completeness-check.mjs"
BUN="${BUN:-bun}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A fixture repo with a `base` branch standing in for origin/main, and a
# `tip` branch standing in for the composed soup tip.
new_fixture() {
    local d="$TMP/$1"
    rm -rf "$d"; mkdir -p "$d/shared/src" "$d/hub/src" "$d/config"
    git -C "$d" init -q
    git -C "$d" config user.email t@example.com
    git -C "$d" config user.name t
    printf 'export const Keep = 1\nexport type Thing = string\n' > "$d/shared/src/apiTypes.ts"
    printf 'export const a = 1\n' > "$d/hub/src/alpha.ts"
    git -C "$d" add -A && git -C "$d" commit -qm base
    git -C "$d" branch -M base
    git -C "$d" checkout -q -b tip
    echo "$d"
}

run_check() {
    HAPI_SOUP_BASE_REF=base "$BUN" run "$CHECK" "$1" 2>&1
}

expect_pass() {
    local d="$1" label="$2" out
    if out=$(run_check "$d"); then
        echo "OK pass: $label"
    else
        echo "FAIL expected pass: $label" >&2; echo "$out" >&2; exit 1
    fi
}

expect_fail() {
    local d="$1" label="$2" needle="$3" out
    if out=$(run_check "$d"); then
        echo "FAIL expected failure: $label" >&2; echo "$out" >&2; exit 1
    fi
    if ! printf '%s' "$out" | grep -q "$needle"; then
        echo "FAIL wrong reason: $label (want /$needle/)" >&2; echo "$out" >&2; exit 1
    fi
    echo "OK fail: $label"
}

# 1. clean tip that merged the base
d=$(new_fixture clean)
git -C "$d" merge -q base -m merge 2>/dev/null || true
expect_pass "$d" "clean absorbed tip"

# 2. zero-byte source file on an absorbed tip
d=$(new_fixture zero)
: > "$d/hub/src/alpha.ts"
git -C "$d" commit -qam "empty alpha"
expect_fail "$d" "zero-byte source file" "ZERO BYTES"

# 3. pre-absorb tip: base has files the tip never saw — NOT damage
d=$(new_fixture behind)
git -C "$d" checkout -q base
printf 'export const newer = 1\n' > "$d/hub/src/added-later.ts"
git -C "$d" add -A && git -C "$d" commit -qm "base moves ahead"
git -C "$d" checkout -q tip
expect_pass "$d" "pre-absorb tip missing later base files"

# 4. absorbed tip that dropped a base file
d=$(new_fixture dropped)
git -C "$d" merge -q base -m merge 2>/dev/null || true
git -C "$d" rm -q "$d/hub/src/alpha.ts" 2>/dev/null || git -C "$d" rm -q hub/src/alpha.ts
git -C "$d" commit -qm "drop alpha"
expect_fail "$d" "dropped upstream file" "absent from the tip"

# 5. same drop, allowlisted
printf '# deliberate: layer x replaces alpha\nhub/src/alpha.ts\n' > "$d/config/soup-base-completeness-allow.txt"
git -C "$d" add -A && git -C "$d" commit -qm allow
expect_pass "$d" "allowlisted deliberate deletion"

# 6. contract export lost from an absorbed tip
d=$(new_fixture symbols)
git -C "$d" merge -q base -m merge 2>/dev/null || true
printf 'export const Keep = 1\n' > "$d/shared/src/apiTypes.ts"
git -C "$d" commit -qam "drop Thing export"
expect_fail "$d" "lost contract export" "exported symbol"

# 7. zero-byte is NOT allowlistable
d=$(new_fixture zeroallow)
: > "$d/hub/src/alpha.ts"
printf 'hub/src/alpha.ts\n' > "$d/config/soup-base-completeness-allow.txt"
git -C "$d" add -A && git -C "$d" commit -qm "empty + allow"
expect_fail "$d" "zero-byte ignores allowlist" "ZERO BYTES"

# 8. Paired impl+test loss vs the serving tip fails closed, because a green
#    suite proves nothing when the tests left with the code they covered.
d=$(new_fixture paired)
printf 'export const impl = 1\n' > "$d/hub/src/thing.ts"
printf 'test("thing", () => {})\n' > "$d/hub/src/thing.test.ts"
git -C "$d" add -A && git -C "$d" commit -qm "impl + test"
git -C "$d" branch -M serving
git -C "$d" checkout -q -b tip2
git -C "$d" rm -q hub/src/thing.ts hub/src/thing.test.ts
git -C "$d" commit -qm "drop both"
if out=$(HAPI_SOUP_PREV_TIP=serving HAPI_SOUP_BASE_REF=base "$BUN" run "$CHECK" "$d" 2>&1); then
    echo "FAIL expected failure: paired impl+test loss" >&2; echo "$out" >&2; exit 1
fi
printf '%s' "$out" | grep -q "vanished together" \
    && echo "OK fail: paired impl+test loss vs serving tip" \
    || { echo "FAIL wrong reason: paired loss" >&2; echo "$out" >&2; exit 1; }

# 9. A lone test removal is only reported, not failed: upstream retires tests.
git -C "$d" checkout -q serving
git -C "$d" checkout -q -b tip3
git -C "$d" rm -q hub/src/thing.test.ts
git -C "$d" commit -qm "drop only the test"
if out=$(HAPI_SOUP_PREV_TIP=serving HAPI_SOUP_BASE_REF=base "$BUN" run "$CHECK" "$d" 2>&1); then
    printf '%s' "$out" | grep -q "none paired with their implementation" \
        && echo "OK pass: lone test removal reported, not failed" \
        || { echo "FAIL: lone test removal should be reported" >&2; echo "$out" >&2; exit 1; }
else
    echo "FAIL expected pass: lone test removal" >&2; echo "$out" >&2; exit 1
fi

echo "all soup-base-completeness cases passed"
