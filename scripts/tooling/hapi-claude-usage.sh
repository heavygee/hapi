#!/usr/bin/env bash
# hapi-claude-usage — smoke Claude dual-slot quota (primary | secondary).
#
# Cursor twin: smoke half of hapi-cursor-account-toggle (Claude has two Max
# slots with independent reset clocks, so quota needs its own command).
#
# Usage:
#   hapi-claude-usage                  # both slots + mark active
#   hapi-claude-usage secondary        # one slot
#   hapi-claude-usage primary secondary
#   hapi-claude-usage --active         # only ~/.hapi/claude-auth/active
#   hapi-claude-usage --json
#
# Exit codes:
#   0  every requested slot is ok (not capped)
#   1  at least one requested slot is capped
#   2  auth/connectivity/usage error on a requested slot

set -euo pipefail
export PATH="/usr/bin:/bin:${HOME}/.local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

FORMAT=table
WANT_ACTIVE=0
SLOTS=()
TIMEOUT_S="${HAPI_CLAUDE_USAGE_TIMEOUT:-35}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) FORMAT=json; shift ;;
        --active) WANT_ACTIVE=1; shift ;;
        --timeout) TIMEOUT_S="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -25
            exit 0
            ;;
        primary|secondary) SLOTS+=("$1"); shift ;;
        both|all) SLOTS+=(primary secondary); shift ;;
        *) echo "hapi-claude-usage: unknown arg: $1" >&2; exit 2 ;;
    esac
done

ACTIVE="$(hapi_claude_active_slot 2>/dev/null || true)"

if [[ "$WANT_ACTIVE" -eq 1 ]]; then
    [[ -n "$ACTIVE" ]] || { echo "hapi-claude-usage: no active slot marker at $HAPI_CLAUDE_AUTH_ROOT/active" >&2; exit 2; }
    SLOTS=("$ACTIVE")
fi
if [[ ${#SLOTS[@]} -eq 0 ]]; then
    SLOTS=(primary secondary)
fi

# de-dupe while preserving order
declare -A SEEN=()
UNIQUE=()
for s in "${SLOTS[@]}"; do
    [[ -n "${SEEN[$s]:-}" ]] && continue
    SEEN[$s]=1
    UNIQUE+=("$s")
done
SLOTS=("${UNIQUE[@]}")

ROWS_JSON=()
ANY_CAPPED=0
ANY_ERR=0

for slot in "${SLOTS[@]}"; do
    sha="$(hapi_claude_slot_sha12 "$slot" 2>/dev/null || echo missing)"
    set +e
    result="$(hapi_claude_smoke_slot "$slot" "$TIMEOUT_S")"
    rc=$?
    set -e
    status="${result%%|*}"
    detail="${result#*|}"
    mark=""
    [[ "$slot" == "$ACTIVE" ]] && mark=" (active)"
    case "$status" in
        ok) ;;
        capped) ANY_CAPPED=1 ;;
        *) ANY_ERR=1 ;;
    esac
    if [[ "$FORMAT" == "json" ]]; then
        ROWS_JSON+=("$(python3 -c 'import json,sys; print(json.dumps({"slot":sys.argv[1],"sha12":sys.argv[2],"status":sys.argv[3],"detail":sys.argv[4],"active":sys.argv[5]=="1"}))' \
            "$slot" "$sha" "$status" "$detail" "$([[ "$slot" == "$ACTIVE" ]] && echo 1 || echo 0)")")
    else
        printf '%-10s sha12=%-12s %-6s %s%s\n' "$slot" "$sha" "$status" "$detail" "$mark"
    fi
done

if [[ "$FORMAT" == "json" ]]; then
    printf '{"active":%s,"rows":[%s]}\n' \
        "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1] or None))' "$ACTIVE")" \
        "$((IFS=,; echo "${ROWS_JSON[*]}"))"
else
    [[ -n "$ACTIVE" ]] && echo "active marker: $ACTIVE" || echo "active marker: (none)"
fi

if [[ "$ANY_ERR" -eq 1 ]]; then
    exit 2
fi
if [[ "$ANY_CAPPED" -eq 1 ]]; then
    exit 1
fi
exit 0
