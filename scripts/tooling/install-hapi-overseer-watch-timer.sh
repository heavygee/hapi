#!/usr/bin/env bash
# install-hapi-overseer-watch-timer.sh
#
# Install the machine-local systemd timer for the Overseer inbox watch-loop
# (Gap 2 — see docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md).
# Fork-local. NOT part of Tier-1. NOT upstreamable. Safe to re-run.
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-overseer-watch-timer.sh
#   sudo bash scripts/tooling/install-hapi-overseer-watch-timer.sh --run-now
#   sudo bash scripts/tooling/install-hapi-overseer-watch-timer.sh --disable

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
            sed -n '2,12p' "$0"
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

if [[ "$DO_DISABLE" -eq 1 ]]; then
    systemctl disable --now hapi-overseer-watch.timer 2>/dev/null || true
    echo "Disabled Overseer watch-loop timer."
    systemctl list-timers 'hapi-overseer-watch*' --all --no-pager || true
    exit 0
fi

for f in hapi-overseer-watch.service hapi-overseer-watch.timer; do
    if [[ ! -f "$SYS_D/$f" ]]; then
        echo "ERROR: missing $SYS_D/$f" >&2
        exit 1
    fi
done

install -d -m 0755 -o heavygee -g heavygee "$STATE_DIR"
install -m 0644 "$SYS_D/hapi-overseer-watch.service" /etc/systemd/system/hapi-overseer-watch.service
install -m 0644 "$SYS_D/hapi-overseer-watch.timer" /etc/systemd/system/hapi-overseer-watch.timer

systemctl daemon-reload
systemctl enable --now hapi-overseer-watch.timer

echo
echo "Installed Overseer watch-loop timer (every 30 min: :08 and :38)."
systemctl is-enabled hapi-overseer-watch.timer || true
systemctl list-timers 'hapi-overseer-watch*' --all --no-pager

echo
echo "Manual run:"
echo "  sudo systemctl start hapi-overseer-watch.service"
echo "  journalctl -u hapi-overseer-watch -n 50 --no-pager"
echo "Disable: sudo bash $0 --disable"

if [[ "$DO_RUN_NOW" -eq 1 ]]; then
    echo
    echo "Starting one tick now..."
    systemctl start hapi-overseer-watch.service
    systemctl --no-pager --full status hapi-overseer-watch.service | head -30 || true
fi
