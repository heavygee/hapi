#!/usr/bin/env bash
# install-hapi-kitchen-watchdog-timer.sh
#
# Install the machine-local systemd timer that pings the remat-hold owner while
# the kitchen is dirty (fork tooling). NOT Tier-1. NOT upstreamable. Safe to
# re-run.
#
# Why this exists: an agent does not run between turns, so it cannot poll its
# own "am I done?" check. On 2026-11-19→22 the tooling/meta seat held a remat
# escalation for 41+ hours while hapi-kitchen-status sat at exit 76, each
# session ending with a confident summary. The poll has to live out here.
#
# Schedule:
#   hapi-kitchen-watchdog.timer — every 20min at :07/:27/:47 (+45s scatter),
#                                 Persistent=true so a hold that went stale
#                                 while the box was down still gets caught.
#
# Behaviour: runs hapi-kitchen-watchdog.sh, which defers entirely to
# hapi-kitchen-status for the verdict (0 green / 75 busy / 1 unclean / 76 hold)
# and pings the hold owner — falling back to config/meta-sessions.yaml
# tooling_meta — only when dirty. Busy does not ping.
#
# Optional ~/.hapi/kitchen-watchdog.env:
#   HAPI_REMAT_HOLD_FILE=<path>   # override hold file location
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-kitchen-watchdog-timer.sh
#   sudo bash scripts/tooling/install-hapi-kitchen-watchdog-timer.sh --run-now
#   sudo bash scripts/tooling/install-hapi-kitchen-watchdog-timer.sh --disable

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYS_D="$REPO_ROOT/scripts/tooling/systemd"
DEST=/etc/systemd/system
RUN_NOW=0
DISABLE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --run-now) RUN_NOW=1; shift ;;
        --disable) DISABLE=1; shift ;;
        -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
        *) echo "Unknown flag: $1" >&2; exit 64 ;;
    esac
done

if [[ "$(id -u)" != "0" ]]; then
    echo "ERROR: needs root to write $DEST — re-run with sudo." >&2
    exit 1
fi

if [[ "$DISABLE" -eq 1 ]]; then
    systemctl disable --now hapi-kitchen-watchdog.timer 2>/dev/null || true
    rm -f "$DEST/hapi-kitchen-watchdog.timer" "$DEST/hapi-kitchen-watchdog.service"
    systemctl daemon-reload
    echo "install-hapi-kitchen-watchdog-timer: DISABLED and removed"
    exit 0
fi

for unit in hapi-kitchen-watchdog.service hapi-kitchen-watchdog.timer; do
    [[ -r "$SYS_D/$unit" ]] || { echo "ERROR: missing $SYS_D/$unit" >&2; exit 1; }
    install -m 0644 "$SYS_D/$unit" "$DEST/$unit"
    echo "  installed $DEST/$unit"
done

# The watchdog is useless if the thing it calls is not executable.
chmod +x "$REPO_ROOT/scripts/tooling/hapi-kitchen-watchdog.sh" 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now hapi-kitchen-watchdog.timer
echo "install-hapi-kitchen-watchdog-timer: ENABLED"
systemctl list-timers --no-pager hapi-kitchen-watchdog.timer 2>/dev/null | head -3

if [[ "$RUN_NOW" -eq 1 ]]; then
    # Deliberately not `systemctl start` — that would hide the verdict in the
    # journal. Run it in the foreground as the service user so the operator
    # sees whether the kitchen is dirty and who got pinged.
    echo "--- one-shot run (as heavygee) ---"
    sudo -u heavygee -H env \
        PATH=/home/heavygee/.local/bin:/usr/local/bin:/usr/bin:/bin \
        HAPI_PRIMARY=/home/heavygee/coding/hapi \
        "$REPO_ROOT/scripts/tooling/hapi-kitchen-watchdog.sh" --dry-run || true
fi
