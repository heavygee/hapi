#!/usr/bin/env bash
# install-hapi-meta-daily-timer.sh
#
# Install machine-local systemd timers for the Meta PR watcher (fork tooling).
# NOT part of Tier-1. NOT upstreamable. Safe to re-run.
#
# Schedules (host timezone — oos-linux is Etc/UTC):
#   hapi-meta-daily.timer         — 08:00 + RandomizedDelaySec=15min (pings OK)
#   hapi-meta-daily-refresh.timer — every 45m 09:00–21:45 (--no-ping --emit-events)
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh
#   sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh --run-now   # one refresh after enable
#   sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh --disable

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYS_D="$REPO_ROOT/scripts/tooling/systemd"
STATE_DIR="/home/heavygee/.local/state/hapi"

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
    hapi-meta-daily.service
    hapi-meta-daily.timer
    hapi-meta-daily-refresh.service
    hapi-meta-daily-refresh.timer
)

if [[ "$DO_DISABLE" -eq 1 ]]; then
    systemctl disable --now hapi-meta-daily.timer hapi-meta-daily-refresh.timer 2>/dev/null || true
    echo "Disabled Meta daily timers."
    systemctl list-timers 'hapi-meta-daily*' --all --no-pager || true
    exit 0
fi

for f in "${UNITS[@]}"; do
    if [[ ! -f "$SYS_D/$f" ]]; then
        echo "ERROR: missing $SYS_D/$f" >&2
        exit 1
    fi
done

install -d -m 0755 -o heavygee -g heavygee "$STATE_DIR"
install -m 0644 "$SYS_D/hapi-meta-daily.service" /etc/systemd/system/hapi-meta-daily.service
install -m 0644 "$SYS_D/hapi-meta-daily.timer" /etc/systemd/system/hapi-meta-daily.timer
install -m 0644 "$SYS_D/hapi-meta-daily-refresh.service" /etc/systemd/system/hapi-meta-daily-refresh.service
install -m 0644 "$SYS_D/hapi-meta-daily-refresh.timer" /etc/systemd/system/hapi-meta-daily-refresh.timer

# Ensure flock path parent exists for the morning unit too (no ExecStartPre there historically)
# Refresh unit has ExecStartPre; morning relies on this install step.

systemctl daemon-reload
systemctl enable --now hapi-meta-daily.timer
systemctl enable --now hapi-meta-daily-refresh.timer

echo
echo "Installed Meta PR watcher timers (fork-local)."
timedatectl show -p Timezone --value 2>/dev/null | awk '{print "Host timezone: " $0}'
systemctl is-enabled hapi-meta-daily.timer hapi-meta-daily-refresh.timer
systemctl list-timers 'hapi-meta-daily*' --all --no-pager

echo
echo "Manual run:"
echo "  sudo systemctl start hapi-meta-daily.service            # morning (pings)"
echo "  sudo systemctl start hapi-meta-daily-refresh.service    # daytime (quiet)"
echo "  journalctl -u hapi-meta-daily -u hapi-meta-daily-refresh -n 50 --no-pager"
echo
echo "Optional env overrides: /home/heavygee/.hapi/meta-daily.env"
echo "Disable: sudo bash $0 --disable"

if [[ "$DO_RUN_NOW" -eq 1 ]]; then
    echo
    echo "Starting one daytime refresh now..."
    systemctl start hapi-meta-daily-refresh.service
    systemctl --no-pager --full status hapi-meta-daily-refresh.service | head -30 || true
fi
