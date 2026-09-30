#!/usr/bin/env bash
# install-hapi-primary-hub-tier1.sh
#
# Install the Tier-1 primary-hub / soup-host hardening package on this machine.
# Idempotent. Safe to re-run. Does NOT install cutover/artifact drop-ins.
#
# Base hub/runner units: install-hapi-systemd-units.sh (runs Tier-1 for system profiles).
# This script alone only installs drop-ins + watchdog when base units already exist.
#
# Installs:
#   - runner: 10-resilience.conf (Restart=always, KillMode=process,
#     HAPI_DISABLE_VERSION_HANDOFF=1, ExecStartPre=runner stop)
#     Rendered per host from 10-resilience.conf.in — the stop command must be
#     valid HERE. Restart=always is only safe with a working stop (see the
#     template's own header). Resolution order:
#       1. --runner-stop-cmd '<full command>'
#       2. --runner-bin /path/to/hapi   ->  '-/path/to/hapi runner stop'
#       3. auto-detect: the runner unit's own ExecStart binary, else
#          /opt/hapi/hapi, else the soup bun invocation
#     Fails closed if none resolve — never installs a stop that cannot run.
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
#   sudo bash scripts/tooling/install-hapi-primary-hub-tier1.sh --runner-bin /opt/hapi/hapi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

DO_RESTART=0
RUNNER_BIN=""
RUNNER_STOP_CMD=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --restart) DO_RESTART=1; shift ;;
        --runner-bin) RUNNER_BIN="${2:?--runner-bin needs a path}"; shift 2 ;;
        --runner-stop-cmd) RUNNER_STOP_CMD="${2:?--runner-stop-cmd needs a command}"; shift 2 ;;
        -h|--help)
            sed -n '2,40p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown arg: $1" >&2
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

# --- Resolve the runner stop command for THIS host -------------------------
#
# Restart=always in the resilience drop-in is only safe if this command really
# stops the running runner. A stop that cannot execute is worse than none: the
# restart hits the runner's dedup path (exit 0), systemd retries, and the unit
# burns StartLimitBurst and lands in `failed`. So resolve explicitly and fail
# closed rather than shipping something that silently no-ops.
#
# The leading `-` is systemd's own "ignore failure" prefix — correct at RUNTIME
# (stopping when nothing runs is fine) but no substitute for validating the
# binary exists at INSTALL time, which is the check that was missing.
resolve_runner_stop_cmd() {
    if [[ -n "$RUNNER_STOP_CMD" ]]; then
        printf '%s' "$RUNNER_STOP_CMD"
        return 0
    fi
    if [[ -n "$RUNNER_BIN" ]]; then
        [[ -x "$RUNNER_BIN" ]] || {
            echo "ERROR: --runner-bin $RUNNER_BIN is not executable" >&2
            exit 1
        }
        printf -- '-%s runner stop' "$RUNNER_BIN"
        return 0
    fi

    # Auto-detect: reuse whatever the installed unit already starts.
    local exec_start bin
    exec_start="$(systemctl show "$RUNNER_UNIT" -p ExecStart --value 2>/dev/null || true)"
    bin="$(sed -n 's/.*argv\[\]=\([^ ]*\).*/\1/p' <<<"$exec_start" | head -n1)"
    if [[ -n "$bin" && "$bin" != /bin/bash && "$bin" != /bin/sh && -x "$bin" ]]; then
        printf -- '-%s runner stop' "$bin"
        return 0
    fi

    if [[ -x /opt/hapi/hapi ]]; then
        printf -- '-/opt/hapi/hapi runner stop'
        return 0
    fi

    # Soup kitchen: the runner is a bun entrypoint, not a single executable.
    local soup_cli="/home/heavygee/coding/hapi/active/cli"
    local bun="/home/heavygee/.bun/bin/bun"
    if [[ -x "$bun" && -d "$soup_cli" ]]; then
        printf -- "-/bin/bash -lc '%s run --cwd %s %s/src/index.ts runner stop'" \
            "$bun" "$soup_cli" "$soup_cli"
        return 0
    fi

    echo "ERROR: cannot determine how to stop the runner on this host." >&2
    echo "       Pass --runner-bin /path/to/hapi (single-exe installs) or" >&2
    echo "       --runner-stop-cmd '<command>' (custom entrypoints)." >&2
    echo "       Refusing to install Restart=always without a working stop." >&2
    exit 1
}

RESOLVED_STOP_CMD="$(resolve_runner_stop_cmd)"
echo "Tier-1 runner stop command: $RESOLVED_STOP_CMD"

mkdir -p "$HUB_D" "$RUNNER_D"

bash "$REPO_ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh" \
    "$SYS_D/10-resilience.conf.in" "$RUNNER_D/10-resilience.conf" \
    "RUNNER_STOP_CMD=$RESOLVED_STOP_CMD"
chmod 0644 "$RUNNER_D/10-resilience.conf"
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
