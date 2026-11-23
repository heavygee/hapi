#!/usr/bin/env bash
# check-operator-leaks — must be able to say BOTH "leak" and "clean", at any size.
#
# WHY THIS FILE EXISTS. The scanner is the backstop for a hard rule (no
# operator-private hostnames in upstream PRs, public issues, or pushed
# commits). It had no test, and on 2026-11-23 it was found failing CLEAN on
# every real-sized input: `scan_text_blob` ran `printf '%s' "$blob" | grep -q`,
# grep -q exits on first match and closes the pipe, and `set -o pipefail`
# promoted the writer's SIGPIPE (141) to the pipeline status — so the `if` read
# a match in anything larger than the pipe buffer (~64KB) as NO MATCH.
# Measured: --git-range over a 1.98MB diff missed a pattern present 16 times.
#
# So the size axis is the point of this file. A small-input-only test suite
# would have passed throughout the entire period the gate was disabled.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$DIR/check-operator-leaks.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

TOKEN='hapi.tail9944ee.ts.net'   # matches a built-in LEAK_PATTERN

# Blob of n bytes with the token at a chosen position.
blob_with_token() {
    local bytes="$1" where="$2" filler
    filler="$(head -c "$bytes" /dev/zero | tr '\0' 'a')"
    case "$where" in
        head) printf '%s%s' "$TOKEN" "$filler" ;;
        tail) printf '%s%s' "$filler" "$TOKEN" ;;
    esac
}

expect_leak() {
    local label="$1" input="$2"
    if printf '%s' "$input" | bash "$S" --stdin >/dev/null 2>&1; then
        bad "$label: expected a leak to be reported (exit non-zero)"
    else
        ok
    fi
}

expect_clean() {
    local label="$1" input="$2"
    if printf '%s' "$input" | bash "$S" --stdin >/dev/null 2>&1; then
        ok
    else
        bad "$label: expected clean (exit 0)"
    fi
}

# 1. Baseline both directions on small input — a scanner that only ever says
#    one thing is worse than none.
expect_leak  "small blob with token"    "prefix $TOKEN suffix"
expect_clean "small blob without token" "nothing private here at all"

# 2. THE REGRESSION. Well past the ~64KB pipe buffer, token at the FRONT so
#    grep -q exits as early as possible — the worst case for the old code and
#    the one that silently passed.
expect_leak "300KB blob, token at head" "$(blob_with_token 300000 head)"

# 3. Token at the END of a large blob: grep reads everything before exiting, so
#    this one happened to survive the old bug. Keeping both positions pins the
#    asymmetry, which is what made the failure so hard to notice.
expect_leak "300KB blob, token at tail" "$(blob_with_token 300000 tail)"

# 4. A large blob with NO token must still be clean — the fix must not turn
#    "big" into "always flagged", which would make the gate unusable and get
#    it bypassed with HAPI_PR_CREATE_NO_LEAK_SCAN=1.
expect_clean "300KB blob, no token" "$(head -c 300000 /dev/zero | tr '\0' 'b')"

# 5. --file path routes through the same primitive.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
blob_with_token 300000 head > "$TMP/big-leak.txt"
if bash "$S" --file "$TMP/big-leak.txt" >/dev/null 2>&1; then
    bad "--file on a 300KB leaky file must exit non-zero"
else
    ok
fi

# 6. An injected pattern (HAPI_OPERATOR_LEAK_PATTERNS_FILE) must work at size
#    too — that env var is how the real patterns are extended, so a size bug
#    there is identical in effect.
printf 'zzInjectedSecretzz\n' > "$TMP/pats"
BIG_INJ="zzInjectedSecretzz$(head -c 300000 /dev/zero | tr '\0' 'c')"
if printf '%s' "$BIG_INJ" | HAPI_OPERATOR_LEAK_PATTERNS_FILE="$TMP/pats" \
        bash "$S" --stdin >/dev/null 2>&1; then
    bad "injected pattern must be detected in a 300KB blob"
else
    ok
fi

# 7. THE ACTUAL REGRESSION PATH, and the only case here that reproduces the
#    2026-11-23 defect. Tests 1-6 go through --stdin and they pass with the
#    bug present (verified: 7/7 both before and after the fix), so they pin
#    behaviour without detecting it. Only --git-range over a large real diff
#    misses deterministically — measured 5/5 missed with the old primitive and
#    5/5 caught after. A suite without this case is theatre.
#
#    The script does `cd "$ROOT"` where ROOT is its own ../.. (line ~15-16), so
#    it ALWAYS scans its own checkout regardless of cwd. To fixture it the
#    script has to be copied into a throwaway repo at the same relative depth.
FX="$TMP/fx"
mkdir -p "$FX/scripts/tooling" "$FX/hub/src"
cp "$S" "$FX/scripts/tooling/"
git -C "$FX" init -q 2>/dev/null
git -C "$FX" config user.email t@t; git -C "$FX" config user.name t
printf 'export const BASE = 1\n' > "$FX/hub/src/base.ts"
git -C "$FX" add -A >/dev/null 2>&1
git -C "$FX" commit -qm base >/dev/null 2>&1
BASE_SHA="$(git -C "$FX" rev-parse HEAD)"
# Large product-path addition with the token near the FRONT: grep -q exits
# earliest there, which is precisely when the old pipeline died of SIGPIPE.
{
    printf 'const leak = "%s"\n' "$TOKEN"
    head -c 2000000 /dev/zero | tr '\0' 'x' | fold -w 120
} > "$FX/hub/src/big.ts"
git -C "$FX" add -A >/dev/null 2>&1
git -C "$FX" commit -qm "big product change carrying a leak" >/dev/null 2>&1

if (cd "$FX" && bash "$FX/scripts/tooling/check-operator-leaks.sh" \
        --git-range "$BASE_SHA" HEAD >/dev/null 2>&1); then
    bad "--git-range over a 2MB product diff must report the leak (exit non-zero)"
else
    ok
fi

# 8. And the same range with the token removed must be clean, so test 7 is
#    proving detection rather than "big diff always fails".
printf 'const leak = "nothing here"\n' > "$FX/hub/src/big.ts"
head -c 2000000 /dev/zero | tr '\0' 'x' | fold -w 120 >> "$FX/hub/src/big.ts"
git -C "$FX" add -A >/dev/null 2>&1
git -C "$FX" commit -qm "same size, no leak" >/dev/null 2>&1
if (cd "$FX" && bash "$FX/scripts/tooling/check-operator-leaks.sh" \
        --git-range "$BASE_SHA" HEAD >/dev/null 2>&1); then
    ok
else
    bad "--git-range over a 2MB clean product diff must exit 0"
fi

echo "check-operator-leaks.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
