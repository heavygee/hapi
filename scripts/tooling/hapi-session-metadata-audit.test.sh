#!/usr/bin/env bash
# Tests for hapi-session-metadata-audit.
#
# Every check is driven RED as well as green. A metadata auditor that only
# ever runs against a healthy estate proves nothing — the 2026-11-24 incident
# was 96 sessions silently unrestartable while every dashboard looked fine.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT="$HERE/hapi-session-metadata-audit.sh"
DRIVER="${HAPI_TEST_DRIVER:-$(readlink -f "${HAPI_ACTIVE:-$HOME/coding/hapi/active}" 2>/dev/null || echo "$HOME/coding/hapi/driver")}"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $*" >&2; }

[[ -f "$DRIVER/shared/src/schemas.ts" ]] || { echo "no driver schema at $DRIVER — set HAPI_TEST_DRIVER" >&2; exit 2; }

TMP="$(mktemp -d -t hapi-meta-audit-test-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdb() { # mkdb <file> <json-metadata>...
    local db="$1"; shift
    sqlite3 "$db" "CREATE TABLE sessions (id TEXT PRIMARY KEY, metadata TEXT);"
    local n=0
    for meta in "$@"; do
        n=$((n+1))
        sqlite3 "$db" "INSERT INTO sessions VALUES ('sess-$n', json('$meta'));"
    done
}

GOOD='{"path":"/work/coding/hapi","host":"h","machineId":"m","flavor":"claude","lifecycleState":"idle"}'
# the exact 2026-11-24 shape: lastModelError written before eventId was required
STALE_ERR='{"path":"/work/coding/hapi","host":"h","machineId":"m","flavor":"claude","lifecycleState":"idle","lastModelError":{"kind":"transport_closed","transient":true,"atTs":1786637269050}}'
# the other 2026-11-24 shape: two primary github_pr refs
TWO_PRIMARY='{"path":"/work/coding/hapi","host":"h","machineId":"m","flavor":"claude","lifecycleState":"idle","externalRefs":[{"kind":"github_pr","repo":"a/b","number":1,"url":"https://github.com/a/b/pull/1","role":"primary"},{"kind":"github_pr","repo":"a/c","number":2,"url":"https://github.com/a/c/pull/2","role":"primary"}]}'
BAD_TYPE='{"path":42,"host":"h","machineId":"m","flavor":"claude","lifecycleState":"idle"}'

run() { bash "$AUDIT" --driver "$DRIVER" --db "$1" --quiet --json "$TMP/out.json" >/dev/null 2>"$TMP/err.txt"; echo $?; }

# 1. GREEN — a healthy row passes
mkdb "$TMP/good.db" "$GOOD"
[[ "$(run "$TMP/good.db")" == "0" ]] && ok "clean estate exits 0" || bad "clean estate should exit 0"

# 2. RED — the stale lastModelError shape is caught
mkdb "$TMP/stale.db" "$GOOD" "$STALE_ERR"
rc="$(run "$TMP/stale.db")"
[[ "$rc" == "1" ]] && ok "stale lastModelError exits 1" || bad "stale lastModelError should exit 1 (got $rc)"
grep -q 'lastModelError' "$TMP/err.txt" && ok "names lastModelError in the report" || bad "report should name lastModelError"
[[ "$(jq -r '.invalid' "$TMP/out.json")" == "1" ]] && ok "counts exactly 1 invalid row" || bad "should count 1 invalid"

# 3. RED — two primary PRs are caught
mkdb "$TMP/twoprim.db" "$TWO_PRIMARY"
rc="$(run "$TMP/twoprim.db")"
[[ "$rc" == "1" ]] && ok "two primary github_pr exits 1" || bad "two primaries should exit 1 (got $rc)"
grep -qi 'primary' "$TMP/err.txt" && ok "names the primary-PR constraint" || bad "report should name the primary constraint"

# 4. RED — a plain type error is caught
mkdb "$TMP/badtype.db" "$BAD_TYPE"
[[ "$(run "$TMP/badtype.db")" == "1" ]] && ok "wrong-typed path exits 1" || bad "wrong-typed path should exit 1"

# 5. the good row in a mixed db is NOT reported
mkdb "$TMP/mixed.db" "$GOOD" "$STALE_ERR" "$GOOD"
run "$TMP/mixed.db" >/dev/null
[[ "$(jq -r '.total' "$TMP/out.json")" == "3" && "$(jq -r '.invalid' "$TMP/out.json")" == "1" ]] \
    && ok "mixed db: 3 total, only 1 invalid" || bad "mixed db should be 3 total / 1 invalid"

# 6. infra guards
[[ "$(bash "$AUDIT" --db /nonexistent.db --quiet >/dev/null 2>&1; echo $?)" == "2" ]] \
    && ok "missing db exits 2 (infra), not 0" || bad "missing db should exit 2"
[[ "$(bash "$AUDIT" --driver /nonexistent --db "$TMP/good.db" --quiet >/dev/null 2>&1; echo $?)" == "2" ]] \
    && ok "missing driver schema exits 2, not a false clean" || bad "missing driver should exit 2"

echo
echo "  $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
