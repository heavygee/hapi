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

# Computed relative to the actual run, not hardcoded — a fixed "currently
# active" date pair goes stale the moment the wall clock passes it, silently
# flipping these fixtures' meaning (control A would start blocking instead of
# excusing; the ceiling fixture's entries would stop counting as active) and
# permanently reddening the tooling-tests CI job that runs this file on every
# relevant PR (cold review, 2026-10-15). Control C's PAST dates are
# deliberately literal — "already expired" needs to stay true forever, not
# just today.
TODAY="$(date -u +%Y-%m-%d)"
FUTURE="$(date -u -d '+10 days' +%Y-%m-%d)"
RENEWAL_TOO_FAR="$(date -u -d '+47 days' +%Y-%m-%d)"

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
    # __TODAY__/__FUTURE__/__RENEWAL_TOO_FAR__ placeholders let call sites
    # stay single-quoted (no accidental bash interpolation of the literal
    # YAML) while still resolving to the actual run's dates.
    local content="$1"
    content="${content//__TODAY__/$TODAY}"
    content="${content//__FUTURE__/$FUTURE}"
    content="${content//__RENEWAL_TOO_FAR__/$RENEWAL_TOO_FAR}"
    cat >"$TMP/registry.yaml" <<EOF
quarantine:
$content
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

run_check_pkg() {
    local pkg="$1"
    set +e
    bun "$CLI" check --results "$TMP/results.json" --registry "$TMP/registry.yaml" --skip-issue-check --package "$pkg" >"$TMP/out.log" 2>&1
    echo $?
    set -e
}

# --- Control A: matching signature does not block ---------------------------
registry '  - id: "cli:suite does the thing"
    owner: "alice"
    issue: 1
    signature: "expected true to be false"
    added: "__TODAY__"
    expires: "__FUTURE__"'
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
    added: "__TODAY__"
    expires: "__FUTURE__"'
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
    added: "__TODAY__"
    expires: "__FUTURE__"'
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
    added: "__TODAY__"
    expires: "__RENEWAL_TOO_FAR__"
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
    added: "__TODAY__"
    expires: "__FUTURE__"
    renewal_count: 1'
results '[]'
rc=$(run_check)
check_exit "schema: renewal without a reason is rejected" 1 "$rc"
grep -q "renewal_count > 0 requires a renewal_reason" "$TMP/out.log" || { echo "FAIL: missing-renewal-reason error not found"; fail=1; }

# --- Regression (cold review, 2026-10-15): a partially-numeric issue must be
# rejected, not silently truncated to its numeric prefix. Before the fix,
# Number.parseInt("27O", 10) === 27 — a typo'd issue number would silently
# point at a different, unrelated open issue.
registry '  - id: "cli:bad issue number"
    owner: "alice"
    issue: 27O
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"'
results '[]'
rc=$(run_check)
check_exit "schema: a partially-numeric issue (27O) is rejected, not truncated to 27" 1 "$rc"
grep -q "issue must be a positive GitHub issue number" "$TMP/out.log" || { echo "FAIL: bad-issue error not found"; fail=1; }

# --- Regression (cold review, 2026-10-15): a day-overflow date (2026-02-30,
# which JS Date silently normalizes to 2026-03-02) must be rejected, not
# silently shifted — a mistyped expiry should not quietly extend or shorten
# the quarantine window.
registry '  - id: "cli:bad date"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "2026-02-30"'
results '[]'
rc=$(run_check)
check_exit "schema: a day-overflow date (2026-02-30) is rejected" 1 "$rc"
grep -q "not a valid calendar date" "$TMP/out.log" || { echo "FAIL: day-overflow error not found"; fail=1; }

# --- Regression (cold review, 2026-10-15): an entry must be recognized even
# when `id` is not the FIRST field on the list item. Before the fix, only a
# literal `- id:` line started a new entry, so an item like `- owner: ...`
# followed by `  id: ...` silently never created an entry at all — the
# fields were dropped on the floor rather than raising a "missing id" error.
registry '  - owner: "alice"
    id: "cli:id not first"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"'
results '[{"id":"cli:id not first","failed":true,"message":"x"}]'
rc=$(run_check)
check_exit "schema: an entry is parsed even when id is not the first field" 0 "$rc"
grep -q "EXCUSED: cli:id not first" "$TMP/out.log" || { echo "FAIL: reordered-field entry was not recognized"; fail=1; }

# --- Ceiling: too many active entries blocks regardless of test outcome ----
registry '  - id: "cli:a"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"
  - id: "cli:b"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"
  - id: "cli:c"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"'
results '[]'
rc=$(run_check 2)
check_exit "ceiling: 3 active entries over ceiling=2 blocks with no test failures" 1 "$rc"
grep -q "CEILING EXCEEDED" "$TMP/out.log" || { echo "FAIL: ceiling message not found"; fail=1; }

# --- Regression (cold review, 2026-10-15): an unrelated package's broken
# entry must NOT fail a --package-scoped check. Before the fix, `check` with
# no package filter validated the WHOLE registry, so a schema error on an
# `ios:` entry (here: missing owner) would fail a cli-only gate run even
# though every cli test passed. --package cli must ignore it entirely; an
# unscoped `validate` must still catch it (whole-registry health is its job).
registry '  - id: "cli:unaffected cli test"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"
  - id: "ios:some broken entry"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"'
results '[{"id":"cli:unaffected cli test","failed":false,"message":""}]'
rc=$(run_check_pkg cli)
check_exit "cross-package: --package cli ignores a broken ios: entry" 0 "$rc"
grep -q "INVALID" "$TMP/out.log" && { echo "FAIL: --package cli should not even report the ios entry's error"; fail=1; }

set +e
bun "$CLI" validate --registry "$TMP/registry.yaml" --skip-issue-check >"$TMP/out.log" 2>&1
vrc=$?
set -e
check_exit "cross-package: unscoped validate still catches the broken ios: entry" 2 "$vrc"
grep -q "INVALID \[owner\] ios:some broken entry" "$TMP/out.log" || { echo "FAIL: validate did not report the broken ios entry"; fail=1; }

# --- Regression (cold review, 2026-10-15): a runner-level crash (import
# error, zero tests discovered) exits non-zero while producing NO per-test
# assertion results at all. Before --runner-exit-code existed, that normalized
# to an empty results list and the gate reported a clean pass despite the
# runner itself having failed.
registry '  - id: "cli:irrelevant"
    owner: "alice"
    issue: 1
    signature: "x"
    added: "__TODAY__"
    expires: "__FUTURE__"'
results '[]'
set +e
bun "$CLI" check --results "$TMP/results.json" --registry "$TMP/registry.yaml" --skip-issue-check --package cli --runner-exit-code 1 >"$TMP/out.log" 2>&1
rc=$?
set -e
check_exit "runner-exit-code: nonzero exit with zero attributable failures still blocks" 1 "$rc"
grep -q "produced no attributable per-test failure" "$TMP/out.log" || { echo "FAIL: runner-exit-code mismatch message not found"; fail=1; }

# Sanity: runner-exit-code 0 (or omitted) with empty results is a clean pass.
set +e
bun "$CLI" check --results "$TMP/results.json" --registry "$TMP/registry.yaml" --skip-issue-check --package cli --runner-exit-code 0 >"$TMP/out.log" 2>&1
rc=$?
set -e
check_exit "runner-exit-code: zero exit with empty results passes normally" 0 "$rc"

if [[ "$fail" -eq 0 ]]; then
    echo "ALL OK: flaky-quarantine negative controls"
else
    echo "FAILURES ABOVE"
fi
exit "$fail"
