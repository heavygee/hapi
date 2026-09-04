#!/usr/bin/env bash
# hapi-issue-labelling-daily — wake the Issue Labelling HAPI session for its daily sweep.
#
# Fork-local (heavygee estate). NOT upstream. NOT Tier-1.
# Install: sudo bash scripts/tooling/install-hapi-issue-labelling-timer.sh
#
# WHAT IT DOES:
#   Pings the dedicated Issue Labelling session (HAPI_ISSUE_LABELLING_SESSION_ID)
#   with a fixed sweep remit: unlabeled issues + unlabeled PRs (batch) + heavygee
#   low-impact judgment. Resumes inactive sessions via hapi-ping-peer.
#
# WHAT IT WILL NEVER DO:
#   Apply labels itself · merge PRs · invent taxonomy · edit titles/bodies.
#
# Env (~/.hapi/issue-labelling.env):
#   HAPI_ISSUE_LABELLING_SESSION_ID=<full-uuid>   # required
#   HAPI_ISSUE_LABELLING_SESSION_NAME=…           # optional From: name
#   HAPI_HOST / HAPI_SETTINGS — same as other timers
#
# Usage:
#   hapi-issue-labelling-daily.sh           # ping now
#   hapi-issue-labelling-daily.sh --dry-run # print message, no ping

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENV_FILE="${HAPI_ISSUE_LABELLING_ENV:-/home/heavygee/.hapi/issue-labelling.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

DRY=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY=1 ;;
        -h|--help)
            sed -n '2,28p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

SID="${HAPI_ISSUE_LABELLING_SESSION_ID:-}"
if [[ -z "$SID" ]]; then
    echo "ERROR: HAPI_ISSUE_LABELLING_SESSION_ID unset (set in $ENV_FILE)" >&2
    exit 1
fi

NAME="${HAPI_ISSUE_LABELLING_SESSION_NAME:-Issue labelling (tiann/hapi)}"
PING_BIN="${HAPI_ISSUE_LABELLING_PING_BIN:-}"
if [[ -z "$PING_BIN" ]]; then
    if [[ -x "$SCRIPT_DIR/hapi-ping-peer.sh" ]]; then
        PING_BIN="$SCRIPT_DIR/hapi-ping-peer.sh"
    elif command -v hapi-ping-peer >/dev/null 2>&1; then
        PING_BIN="$(command -v hapi-ping-peer)"
    else
        echo "ERROR: hapi-ping-peer not found" >&2
        exit 1
    fi
fi

TODAY="$(date -u +%Y-%m-%d)"
MSG="$(cat <<EOF
Daily issue/PR labelling sweep (${TODAY} UTC).

Remit:
1. Label unlabeled + status:needs-triage-only open issues on tiann/hapi (existing taxonomy only).
2. Label newest unlabeled open PRs in a conservative batch (up to ~20 while backlog exists; then ~10/day). Type + area + clear agent/platform/type; community-pr for external contributors.
3. Scan open heavygee PRs; apply low-impact by judgment only (never on others' PRs).
4. Recreate low-impact label if missing. Never invent labels. Never merge. Never edit titles/bodies.
5. Report short tables: issue/PR | labels added | one-line rationale.

Canon: this session's living procedure + docs/plans/2026-07-31-pr-merge-lanes.md § Label ownership.
EOF
)"

if [[ "$DRY" -eq 1 ]]; then
    echo "Would ping $SID ($NAME) via $PING_BIN:"
    echo "----"
    printf '%s\n' "$MSG"
    exit 0
fi

# Timer is not a broker descendant — mint verified peer attribution.
export HAPI_ESTATE_PEER_ATTRIBUTE=1
export HAPI_SESSION_ID="$SID"
export HAPI_SESSION_NAME="$NAME"

echo "[issue-labelling-daily] pinging $SID …"
"$PING_BIN" "$SID" --message-file - <<<"$MSG"
echo "[issue-labelling-daily] done"
