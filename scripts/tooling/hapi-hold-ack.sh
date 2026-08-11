#!/usr/bin/env bash
# hapi-hold-ack — operator ack for 🛑 needs_operator / babysit.hold.
# Clears the latch so the next Meta run returns to live classify.
# Agent GitHub replies do NOT clear hold.
#
# Usage:
#   hapi-hold-ack 1108
#   hapi-hold-ack tiann/hapi#1108
#   hapi-hold-ack --repo heavygee/hapi 121
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/pr-hold-core.sh
source "$SCRIPT_DIR/lib/pr-hold-core.sh"

STATE_FILE="${HAPI_META_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi/meta-daily.json}"
REPO="${HAPI_PR_REPO:-tiann/hapi}"
PR=""

err() { echo "hapi-hold-ack: $*" >&2; }
die() { err "$*"; exit 2; }

usage() {
    cat <<'EOF'
hapi-hold-ack — ack an operator-hold PR chip (🛑).

Usage:
  hapi-hold-ack <pr>
  hapi-hold-ack <owner/repo>#<pr>
  hapi-hold-ack --repo owner/repo <pr>

Does not ping the coding peer. Next hapi-meta-daily classifies live again.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --repo) REPO="$2"; shift 2 ;;
        --state) STATE_FILE="$2"; shift 2 ;;
        *)
            if [[ "$1" == */*\#* ]]; then
                REPO="${1%%\#*}"
                PR="${1##*\#}"
            elif [[ "$1" == *\#* ]]; then
                PR="${1##*\#}"
            else
                PR="$1"
            fi
            shift
            ;;
    esac
done

[[ -n "$PR" ]] || die "missing PR number (see --help)"
[[ "$PR" =~ ^[0-9]+$ ]] || die "PR must be a number (got: $PR)"
[[ -f "$STATE_FILE" ]] || die "state file missing: $STATE_FILE (run hapi-meta-daily first)"

state="$(jq -c '.' "$STATE_FILE" 2>/dev/null || die "state is not valid JSON: $STATE_FILE")"
key="$(pec_hold_state_key "$REPO" "$PR")"
if ! printf '%s' "$state" | jq -e --arg k "$key" '(.hold[$k] | type) == "object"' >/dev/null 2>&1; then
    die "no hold row for $key"
fi

next="$(pec_hold_ack_state "$state" "$REPO" "$PR")"
tmp="$(mktemp "$(dirname "$STATE_FILE")/.hold-ack.XXXXXX")"
printf '%s' "$next" | jq '.' >"$tmp" && mv -f "$tmp" "$STATE_FILE"
echo "hapi-hold-ack: acked $key — next Meta run returns to live classify"
