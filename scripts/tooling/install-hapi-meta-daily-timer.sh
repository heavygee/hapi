#!/usr/bin/env bash
# install-hapi-meta-daily-timer.sh
#
# Install machine-local systemd timers for the Meta PR watcher (fork tooling).
# NOT part of Tier-1. NOT upstreamable. Safe to re-run.
#
# Schedules:
#   hapi-meta-daily.timer         — hourly at :00 Europe/London
#                                   (BST summer / GMT winter; host may stay UTC)
#                                   + RandomizedDelaySec=2min
#                                   (chip cache + peer pings + wave-clear unlock)
#
# Quiet 45m refresh (hapi-meta-daily-refresh.timer) RETIRED 2026-08-04 —
# hourly cadence + 3h chip mute replaced it. Installer disables leftover units.
#
# Optional ~/.hapi/meta-daily.env:
#   HAPI_META_SESSION_ID=<full-uuid>     # Meta watcher; hourly ping SOURCE (#1203)
#   HAPI_META_SESSION_NAME='meta - PR watcher'
#   HAPI_META_TOOLING_SESSION_ID=<sid>   # wave-clear unlock ping TARGET
#   HAPI_META_WAVE_COLLECT_SECS=1800     # inbox collect fuse (default 30m)
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh
#   sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh --run-now   # one full run after enable
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
            sed -n '2,22p' "$0"
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

systemctl daemon-reload
systemctl enable --now hapi-meta-daily.timer
# Retire quiet refresh if a prior install left it enabled.
systemctl disable --now hapi-meta-daily-refresh.timer 2>/dev/null || true

echo
echo "Installed Meta PR watcher timer (hourly only; quiet refresh disabled)."
timedatectl show -p Timezone --value 2>/dev/null | awk '{print "Host timezone: " $0}'
systemctl is-enabled hapi-meta-daily.timer || true
systemctl is-enabled hapi-meta-daily-refresh.timer 2>/dev/null || echo "hapi-meta-daily-refresh.timer: disabled (expected)"
systemctl list-timers 'hapi-meta-daily*' --all --no-pager

echo
echo "Manual run:"
echo "  sudo systemctl start hapi-meta-daily.service            # hourly ping window (chips + pings + wave)"
echo "  hapi-meta-daily.sh --no-ping --emit-events              # quiet one-shot (no timer)"
echo "  journalctl -u hapi-meta-daily -n 50 --no-pager"
echo
echo "Optional env overrides: /home/heavygee/.hapi/meta-daily.env"
echo "  HAPI_META_TOOLING_SESSION_ID=…   # required for wave-clear unlock ping"
echo "Disable: sudo bash $0 --disable"

if [[ "$DO_RUN_NOW" -eq 1 ]]; then
    echo
    echo "Starting one full Meta run now..."
    systemctl start hapi-meta-daily.service
    systemctl --no-pager --full status hapi-meta-daily.service | head -30 || true
fi
