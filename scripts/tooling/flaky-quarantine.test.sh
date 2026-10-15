#!/usr/bin/env bash
# Negative controls for flaky-quarantine.mjs — prove it can go red, three
# ways, before anyone trusts it to go green:
#   A. quarantined test fails with its KNOWN signature -> does NOT block.
#   B. quarantined test fails with a DIFFERENT signature -> BLOCKS.
#   C. an EXPIRED entry (even with a matching signature) -> BLOCKS.
# Plus schema (missing owner, renewal math, unmatched expiry) and ceiling.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$HERE/flaky-quarantine.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check_exit() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" -eq "$expected" ]]; then
        echo "OK: $desc (exit $actual)"
    else
        echo "FAIL: $desc — expected exit $expected, got $actual"
        fail=1
    fi
}

registry() {
    cat >"$TMP/registry.yaml" <<EOF
quarantine:
$1
EOF
}

results() {
    printf '%s' "$1" >"$TMP/results.json"
}

run_check() {
    set +e
    bun "$CLI" check --results "$TMP/results.json" --registry "$TMP/registry.yaml" --skip-issue-check --ceiling "${1:-8}" >"$TMP/out.log" 2>&1
    echo $?
    set -e
}

# --- Control A: matching signature does not block ---------------------------
registry '  - id: "cli:suite does the thing"
    owner: "alice"
    issue: 1
    signature: "expected true to be false"
    added: "2026-10-15"
    expires: "2026-10-29"'
results '[{"id":"cli:suite does the thing","failed":true,"message":"AssertionError: expected true to be false"}]'
rc=$(run_check)
check_exit "A: matching signature excuses the failure" 0 "$rc"
grep -q "EXCUSED: cli:suite does the thing" "$TMP/out.log" || { echo "FAIL: A missing EXCUSED line"; fail=1; }

# --- Control B: id matches, signature does not -> blocks ---------------------
results '[{"id":"cli:suite does the thing","failed":true,"message":"AssertionError: expected 1 to be 2"}]'
rc=$(run_check)
check_exit "B: signature mismatch blocks (new/real failure)" 1 "$rc"
grep -q "BLOCKING: cli:suite does the thing" "$TMP/out.log" || { echo "FAIL: B missing BLOCKING line"; fail=1; }
grep -q "quarantined signature mismatch" "$TMP/out.log" || { echo "FAIL: B missing mismatch reason"; fail=1; }

# --- Control C: expired entry blocks even with a matching signature ---------
registry '  - id: "cli:suite does the thing"
    owner: "alice"
    issue: 1
    signature: "expected true to be false"
    added: "2020-01-01"
    expires: "2020-01-15"'
results '[{"id":"cli:suite does the thing","failed":true,"message":"AssertionError: expected true to be false"}]'
rc=$(run_check)
check_exit "C: expired entry blocks despite matching signature" 1 "$rc"
grep -q "EXPIRED (no longer excuses anything): cli:suite does the thing" "$TMP/out.log" || { echo "FAIL: C missing EXPIRED line"; fail=1; }
grep -q "BLOCKING: cli:suite does the thing" "$TMP/out.log" || { echo "FAIL: C expired entry did not fall through to blocking"; fail=1; }

# --- Sanity: a non-quarantined failing id blocks normally --------------------
registry '  - id: "cli:unrelated test"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"'
results '[{"id":"cli:something else entirely","failed":true,"message":"boom"}]'
rc=$(run_check)
check_exit "sanity: unquarantined failure blocks" 1 "$rc"

# --- Sanity: passing tests never block regardless of registry ---------------
results '[{"id":"cli:something else entirely","failed":false,"message":""}]'
rc=$(run_check)
check_exit "sanity: passing test is always fine" 0 "$rc"

# --- Schema: missing owner is a registry error, not silently ignored -------
registry '  - id: "cli:no owner"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"'
results '[{"id":"cli:no owner","failed":true,"message":"x"}]'
rc=$(run_check)
check_exit "schema: missing owner is a registry error (fails closed)" 1 "$rc"
grep -q "INVALID \[owner\]" "$TMP/out.log" || { echo "FAIL: missing-owner error not reported"; fail=1; }
grep -q "BLOCKING: cli:no owner" "$TMP/out.log" || { echo "FAIL: invalid entry should fail closed (not excuse)"; fail=1; }

# --- Schema: expires pushed past renewal_count math is rejected -------------
registry '  - id: "cli:pushed too far"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-12-01"
    renewal_count: 1
    renewal_reason: "still flaky"'
results '[]'
rc=$(run_check)
check_exit "schema: expires beyond renewal_count math is rejected" 1 "$rc"
grep -q "only allows 28d" "$TMP/out.log" || { echo "FAIL: renewal-math error message not found"; fail=1; }

# --- Schema: renewal_count > 0 without a reason is rejected -----------------
registry '  - id: "cli:no reason"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"
    renewal_count: 1'
results '[]'
rc=$(run_check)
check_exit "schema: renewal without a reason is rejected" 1 "$rc"
grep -q "renewal_count > 0 requires a renewal_reason" "$TMP/out.log" || { echo "FAIL: missing-renewal-reason error not found"; fail=1; }

# --- Ceiling: too many active entries blocks regardless of test outcome ----
registry '  - id: "cli:a"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"
  - id: "cli:b"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"
  - id: "cli:c"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "2026-10-15"
    expires: "2026-10-29"'
results '[]'
rc=$(run_check 2)
check_exit "ceiling: 3 active entries over ceiling=2 blocks with no test failures" 1 "$rc"
grep -q "CEILING EXCEEDED" "$TMP/out.log" || { echo "FAIL: ceiling message not found"; fail=1; }

if [[ "$fail" -eq 0 ]]; then
    echo "ALL OK: flaky-quarantine negative controls"
else
    echo "FAILURES ABOVE"
fi
exit "$fail"
