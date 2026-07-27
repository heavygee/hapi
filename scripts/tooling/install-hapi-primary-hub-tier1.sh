#!/usr/bin/env bash
# install-hapi-primary-hub-tier1.sh
#
# Install the Tier-1 primary-hub / soup-host hardening package on this machine.
# Idempotent. Safe to re-run. Does NOT install cutover/artifact drop-ins.
#
# Installs:
#   - runner: 10-resilience.conf (Restart=always, KillMode=process,
#     HAPI_DISABLE_VERSION_HANDOFF=1, ExecStartPre=runner stop)
#   - runner: 90-oom-protect-runner.conf (OOMScoreAdjust=0)
#   - hub:    90-oom-protect-hub.conf (OOMScoreAdjust=-1000)
#   - hapi-runner-watchdog.service + .timer
#   - /etc/sudoers.d/hapi-watchdog (NOPASSWD runner restart)
#   - refreshes hapi-protect + systemctl wrapper (runner restart allowed)
#
# Detects hapi-*-oos vs hapi-* unit names via lib/hapi-systemd-units.sh.
#
# After install: daemon-reload. Does NOT restart hub/runner unless
# --restart is passed (uses patient hapi-restart-hub).
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-primary-hub-tier1.sh
#   sudo bash scripts/tooling/install-hapi-primary-hub-tier1.sh --restart

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

DO_RESTART=0
for arg in "$@"; do
    case "$arg" in
        --restart) DO_RESTART=1 ;;
        -h|--help)
            sed -n '2,30p' "$0"
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

HUB_UNIT="$(hapi_systemd_hub_unit)"
RUNNER_UNIT="$(hapi_systemd_runner_unit)"
HUB_D="/etc/systemd/system/${HUB_UNIT}.d"
RUNNER_D="/etc/systemd/system/${RUNNER_UNIT}.d"
SYS_D="$REPO_ROOT/scripts/tooling/systemd"

echo "Tier-1 install: hub=$HUB_UNIT runner=$RUNNER_UNIT"

mkdir -p "$HUB_D" "$RUNNER_D"

install -m 0644 "$SYS_D/10-resilience.conf" "$RUNNER_D/10-resilience.conf"
install -m 0644 "$SYS_D/90-oom-protect-runner.conf" "$RUNNER_D/90-oom-protect-runner.conf"
install -m 0644 "$SYS_D/90-oom-protect-hub.conf" "$HUB_D/90-oom-protect-hub.conf"

# KillMode drop-in from earlier wave is redundant once 10-resilience is present;
# leave it if present (harmless duplicate KillMode=process).

install -m 0644 "$SYS_D/hapi-runner-watchdog.service" /etc/systemd/system/hapi-runner-watchdog.service
install -m 0644 "$SYS_D/hapi-runner-watchdog.timer" /etc/systemd/system/hapi-runner-watchdog.timer

# Sudoers: protect (deny hub destroy; allow runner restart) + watchdog NOPASSWD
install -m 0440 "$REPO_ROOT/scripts/tooling/sudoers/hapi-protect" /etc/sudoers.d/hapi-protect
install -m 0440 "$REPO_ROOT/scripts/tooling/sudoers/hapi-watchdog" /etc/sudoers.d/hapi-watchdog
chown root:root /etc/sudoers.d/hapi-protect /etc/sudoers.d/hapi-watchdog
if ! visudo -cf /etc/sudoers.d/hapi-protect || ! visudo -cf /etc/sudoers.d/hapi-watchdog; then
    echo "ERROR: sudoers failed visudo -cf" >&2
    exit 1
fi

# Refresh systemctl wrapper (runner-restart allow path)
bash "$REPO_ROOT/scripts/tooling/install-systemctl-wrapper.sh"

systemctl daemon-reload
systemctl enable hapi-runner-watchdog.timer
systemctl start hapi-runner-watchdog.timer

echo
echo "Effective:"
systemctl show "$RUNNER_UNIT" -p KillMode -p Restart -p Environment --no-pager | head -20
systemctl show "$HUB_UNIT" -p OOMScoreAdjust --no-pager
systemctl is-enabled hapi-runner-watchdog.timer
systemctl list-timers hapi-runner-watchdog.timer --no-pager | head -5

echo
echo "Installed Tier-1 drop-ins + watchdog. Env/KillMode take effect on next runner restart."
if [[ "$DO_RESTART" -eq 1 ]]; then
    if [[ -x /home/heavygee/.local/bin/hapi-restart-hub ]]; then
        echo "Running patient hapi-restart-hub as heavygee..."
        sudo -u heavygee -H /home/heavygee/.local/bin/hapi-restart-hub
    else
        echo "WARN: hapi-restart-hub not in ~/.local/bin; restart manually" >&2
        exit 1
    fi
else
    echo "Apply live: sudo -u heavygee hapi-restart-hub   # or re-run with --restart"
fi
