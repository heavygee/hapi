#!/usr/bin/env bash
# install-hapi-issue-labelling-timer.sh
#
# Install machine-local systemd timer that daily-pings the Issue Labelling
# HAPI session (fork tooling). NOT Tier-1. NOT upstreamable. Safe to re-run.
#
# Schedule: hapi-issue-labelling-daily.timer — 09:00 UTC daily (+ ≤2min jitter)
#
# Requires ~/.hapi/issue-labelling.env with:
#   HAPI_ISSUE_LABELLING_SESSION_ID=<full-uuid>
#   HAPI_ISSUE_LABELLING_SESSION_NAME='Issue labelling (tiann/hapi)'  # optional
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-issue-labelling-timer.sh
#   sudo bash scripts/tooling/install-hapi-issue-labelling-timer.sh --run-now
#   sudo bash scripts/tooling/install-hapi-issue-labelling-timer.sh --disable

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYS_D="$REPO_ROOT/scripts/tooling/systemd"
STATE_DIR="/home/heavygee/.local/state/hapi"
ENV_FILE="/home/heavygee/.hapi/issue-labelling.env"

DO_RUN_NOW=0
DO_DISABLE=0
for arg in "$@"; do
    case "$arg" in
        --run-now) DO_RUN_NOW=1 ;;
        --disable) DO_DISABLE=1 ;;
        -h|--help)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

if [[ "$(id -u)" -ne 0 ]]; then
    echo "ERROR: run as root (sudo bash $0 ...)" >&2
    exit 1
fi

UNITS=(
    hapi-issue-labelling-daily.service
    hapi-issue-labelling-daily.timer
)

if [[ "$DO_DISABLE" -eq 1 ]]; then
    systemctl disable --now hapi-issue-labelling-daily.timer 2>/dev/null || true
    echo "Disabled Issue Labelling daily timer."
    systemctl list-timers 'hapi-issue-labelling*' --all --no-pager || true
    exit 0
fi

for f in "${UNITS[@]}"; do
    if [[ ! -f "$SYS_D/$f" ]]; then
        echo "ERROR: missing $SYS_D/$f" >&2
        exit 1
    fi
done

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: missing $ENV_FILE — create it with HAPI_ISSUE_LABELLING_SESSION_ID=…" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -z "${HAPI_ISSUE_LABELLING_SESSION_ID:-}" ]]; then
    echo "ERROR: HAPI_ISSUE_LABELLING_SESSION_ID empty in $ENV_FILE" >&2
    exit 1
fi

install -d -m 0755 -o heavygee -g heavygee "$STATE_DIR"
chmod +x "$REPO_ROOT/scripts/tooling/hapi-issue-labelling-daily.sh"
install -m 0644 "$SYS_D/hapi-issue-labelling-daily.service" /etc/systemd/system/hapi-issue-labelling-daily.service
install -m 0644 "$SYS_D/hapi-issue-labelling-daily.timer" /etc/systemd/system/hapi-issue-labelling-daily.timer

systemctl daemon-reload
systemctl enable --now hapi-issue-labelling-daily.timer

echo
echo "Installed Issue Labelling daily timer (09:00 UTC)."
timedatectl show -p Timezone --value 2>/dev/null | awk '{print "Host timezone: " $0}'
systemctl is-enabled hapi-issue-labelling-daily.timer || true
systemctl list-timers 'hapi-issue-labelling*' --all --no-pager

echo
echo "Manual run:"
echo "  sudo systemctl start hapi-issue-labelling-daily.service"
echo "  journalctl -u hapi-issue-labelling-daily -n 50 --no-pager"
echo "  $REPO_ROOT/scripts/tooling/hapi-issue-labelling-daily.sh --dry-run"
echo
echo "Env: $ENV_FILE"
echo "Disable: sudo bash $0 --disable"

if [[ "$DO_RUN_NOW" -eq 1 ]]; then
    echo
    echo "Starting one labelling wake now..."
    systemctl start hapi-issue-labelling-daily.service
    systemctl --no-pager --full status hapi-issue-labelling-daily.service | head -30 || true
fi
