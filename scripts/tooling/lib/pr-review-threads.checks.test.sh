#!/usr/bin/env bash
# Tests for prt_checks_settled / prt_external_review_count.
#
# The regressions these pin both happened for real on 2026-11-17 against
# tiann/hapi#2481, so the stubs below are the shapes observed, not invented:
# an empty rollup during the post-push window, and a wave where every visible
# check has finished before pr-review exists.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/tooling/lib/pr-review-threads.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0

# Build a fake `gh` that prints $1 for `pr view` and $2 for `api`.
_stub() {
    local view="$1" api="${2:-[]}"
    cat > "$TMP/gh" <<EOF
#!/usr/bin/env bash
case "\$1" in
  pr)  cat <<'JSON'
$view
JSON
       ;;
  api) cat <<'JSON'
$api
JSON
       ;;
esac
EOF
    chmod +x "$TMP/gh"
    PRT_GH_BIN="$TMP/gh"
}

_case() { # name expected_rc
    local name="$1" want="$2" out rc
    out="$(prt_checks_settled acme repo 1 2>/dev/null)"; rc=$?
    if [[ "$rc" -eq "$want" ]]; then
        echo "OK  rc=$rc  $name"
        echo "      -> $out"
    else
        echo "FAIL want rc=$want got rc=$rc  $name" >&2; echo "      -> $out" >&2; fail=1
    fi
}

# --- THE INCIDENT: empty rollup must NOT read as settled ---
_stub '{"headRefOid":"2ea0fcd08aa","statusCheckRollup":[]}'
_case "empty rollup during post-push window is NOT settled" 1

# --- THE SECOND INCIDENT: all visible checks done, pr-review not created yet ---
_stub '{"headRefOid":"2ea0fcd08aa","statusCheckRollup":[
  {"name":"drift-gate","status":"COMPLETED","conclusion":"SUCCESS"},
  {"name":"test","status":"COMPLETED","conclusion":"SUCCESS"}]}'
_case "zero pending but pr-review absent is NOT settled" 1

# --- genuinely settled ---
_stub '{"headRefOid":"2ea0fcd08aa","statusCheckRollup":[
  {"name":"drift-gate","status":"COMPLETED","conclusion":"SUCCESS"},
  {"name":"pr-review","status":"COMPLETED","conclusion":"SUCCESS"},
  {"name":"test","status":"COMPLETED","conclusion":"SUCCESS"}]}'
_case "all complete including pr-review IS settled" 0

# --- still running ---
_stub '{"headRefOid":"2ea0fcd08aa","statusCheckRollup":[
  {"name":"drift-gate","status":"COMPLETED","conclusion":"SUCCESS"},
  {"name":"pr-review","status":"IN_PROGRESS","conclusion":null},
  {"name":"test","status":"QUEUED","conclusion":null}]}'
_case "pending checks are NOT settled" 1

# --- pr-review present but itself still pending ---
_stub '{"headRefOid":"2ea0fcd08aa","statusCheckRollup":[
  {"name":"drift-gate","status":"COMPLETED","conclusion":"SUCCESS"},
  {"name":"pr-review","status":"IN_PROGRESS","conclusion":null}]}'
_case "pr-review present but unfinished is NOT settled" 1

# --- unreadable: fail closed with rc=2, never 0 ---
cat > "$TMP/gh" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$TMP/gh"; PRT_GH_BIN="$TMP/gh"
_case "unreadable response fails closed (rc=2, not settled)" 2

# --- external review count: the #2481 shape ---
_stub '{}' '[
  {"user":{"login":"heavygee"},"state":"COMMENTED"},
  {"user":{"login":"heavygee"},"state":"COMMENTED"},
  {"user":{"login":"heavygee"},"state":"COMMENTED"},
  {"user":{"login":"heavygee"},"state":"COMMENTED"},
  {"user":{"login":"github-actions[bot]"},"state":"COMMENTED"}]'
n="$(prt_external_review_count acme repo 1)"
if [[ "$n" == "0" ]]; then
    echo "OK  external review count = 0 for self-replies + bot (the #2481 shape)"
else
    echo "FAIL expected 0 external reviews, got '$n'" >&2; fail=1
fi

# --- and a genuine outside reviewer IS counted (positive control) ---
_stub '{}' '[
  {"user":{"login":"heavygee"},"state":"COMMENTED"},
  {"user":{"login":"tiann"},"state":"APPROVED"}]'
n="$(prt_external_review_count acme repo 1)"
if [[ "$n" == "1" ]]; then
    echo "OK  a real outside reviewer IS counted (positive control)"
else
    echo "FAIL expected 1 external review, got '$n'" >&2; fail=1
fi

[[ "$fail" -eq 0 ]] && echo "ALL PASS" || { echo "FAILURES" >&2; exit 1; }
