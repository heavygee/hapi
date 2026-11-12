#!/usr/bin/env bash
# install-hapi-dogfood-fit-timer.sh
#
# Install machine-local systemd timer that weekly-pings the Dogfood-fit triage
# HAPI session (fork tooling). NOT Tier-1. NOT upstreamable. Safe to re-run.
#
# Schedule: hapi-dogfood-fit-weekly.timer — Mon 09:00 Europe/London (+ ≤5min jitter)
#
# Requires ~/.hapi/dogfood-fit.env with:
#   HAPI_DOGFOOD_FIT_SESSION_ID=<full-uuid>
#   HAPI_DOGFOOD_FIT_SESSION_NAME='Dogfood-fit triage (tiann/hapi)'  # optional
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-dogfood-fit-timer.sh
#   sudo bash scripts/tooling/install-hapi-dogfood-fit-timer.sh --run-now
#   sudo bash scripts/tooling/install-hapi-dogfood-fit-timer.sh --disable

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYS_D="$REPO_ROOT/scripts/tooling/systemd"
STATE_DIR="/home/heavygee/.local/state/hapi"
ENV_FILE="/home/heavygee/.hapi/dogfood-fit.env"

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
    hapi-dogfood-fit-weekly.service
    hapi-dogfood-fit-weekly.timer
)

if [[ "$DO_DISABLE" -eq 1 ]]; then
    systemctl disable --now hapi-dogfood-fit-weekly.timer 2>/dev/null || true
    echo "Disabled dogfood-fit weekly timer."
    systemctl list-timers 'hapi-dogfood-fit*' --all --no-pager || true
    exit 0
fi

for f in "${UNITS[@]}"; do
    if [[ ! -f "$SYS_D/$f" ]]; then
        echo "ERROR: missing $SYS_D/$f" >&2
        exit 1
    fi
done

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: missing $ENV_FILE — create it with HAPI_DOGFOOD_FIT_SESSION_ID=…" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -z "${HAPI_DOGFOOD_FIT_SESSION_ID:-}" ]]; then
    echo "ERROR: HAPI_DOGFOOD_FIT_SESSION_ID empty in $ENV_FILE" >&2
    exit 1
fi

install -d -m 0755 -o heavygee -g heavygee "$STATE_DIR"
chmod +x "$REPO_ROOT/scripts/tooling/hapi-dogfood-fit-weekly.sh"
install -m 0644 "$SYS_D/hapi-dogfood-fit-weekly.service" /etc/systemd/system/hapi-dogfood-fit-weekly.service
install -m 0644 "$SYS_D/hapi-dogfood-fit-weekly.timer" /etc/systemd/system/hapi-dogfood-fit-weekly.timer

systemctl daemon-reload
systemctl enable --now hapi-dogfood-fit-weekly.timer

echo
echo "Installed dogfood-fit weekly timer (Mon 09:00 Europe/London)."
timedatectl show -p Timezone --value 2>/dev/null | awk '{print "Host timezone: " $0}'
systemctl is-enabled hapi-dogfood-fit-weekly.timer || true
systemctl list-timers 'hapi-dogfood-fit*' --all --no-pager

echo
echo "Manual run:"
echo "  sudo systemctl start hapi-dogfood-fit-weekly.service"
echo "  journalctl -u hapi-dogfood-fit-weekly -n 50 --no-pager"
echo "  $REPO_ROOT/scripts/tooling/hapi-dogfood-fit-weekly.sh --dry-run"
echo "  $REPO_ROOT/scripts/tooling/hapi-dogfood-fit-weekly.sh --thin --dry-run"
echo
echo "Env: $ENV_FILE"
echo "Disable: sudo bash $0 --disable"

if [[ "$DO_RUN_NOW" -eq 1 ]]; then
    echo
    echo "Starting one dogfood-fit wake now..."
    systemctl start hapi-dogfood-fit-weekly.service
    systemctl --no-pager --full status hapi-dogfood-fit-weekly.service | head -30 || true
fi
