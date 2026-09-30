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
#       3. auto-detect: the runner unit's own ExecStart binary, but only when
#          the unit is the single-exe shape, else /opt/hapi/hapi
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
WATCHDOG_USER=""
WATCHDOG_HAPI_HOME=""
WATCHDOG_PORT=""
WITH_WRAPPER=0
WATCHDOG_LIBDIR="/usr/local/lib/hapi"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --restart) DO_RESTART=1; shift ;;
        --runner-bin) RUNNER_BIN="${2:?--runner-bin needs a path}"; shift 2 ;;
        --runner-stop-cmd) RUNNER_STOP_CMD="${2:?--runner-stop-cmd needs a command}"; shift 2 ;;
        --watchdog-user) WATCHDOG_USER="${2:?--watchdog-user needs a user}"; shift 2 ;;
        --hapi-home) WATCHDOG_HAPI_HOME="${2:?--hapi-home needs a path}"; shift 2 ;;
        --hapi-port) WATCHDOG_PORT="${2:?--hapi-port needs a port}"; shift 2 ;;
        --with-systemctl-wrapper) WITH_WRAPPER=1; shift ;;
        -h|--help)
            sed -n '2,36p' "$0"
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
    # 1. Explicit command. Deliberately not introspected — the caller may need a
    #    shell wrapper we cannot validate — but systemd's ignore-failure `-` is
    #    forced on. Without it a stop that fails leaves the unit cycling
    #    activating->failed and the runner never starts AT ALL, which is
    #    strictly worse than the silent no-op this guard exists to prevent.
    if [[ -n "$RUNNER_STOP_CMD" ]]; then
        [[ "$RUNNER_STOP_CMD" == -* ]] || RUNNER_STOP_CMD="-$RUNNER_STOP_CMD"
        printf '%s' "$RUNNER_STOP_CMD"
        return 0
    fi

    # 2. Explicit binary.
    if [[ -n "$RUNNER_BIN" ]]; then
        [[ -f "$RUNNER_BIN" && -x "$RUNNER_BIN" ]] || {
            echo "ERROR: --runner-bin $RUNNER_BIN is not an executable file" >&2
            exit 1
        }
        printf -- '-%s runner stop' "$RUNNER_BIN"
        return 0
    fi

    # 3. Auto-detect, ONLY for the single-exe shape. systemd reports the
    #    executable in `path=` and the full command in `argv[]=`; require argv to
    #    be `<bin> runner start-sync ...` before reusing <bin>. Matching on
    #    "not a shell" instead would fail open: `bun run … runner start-sync`
    #    would yield `bun runner stop`, which exits non-zero ("Script not found")
    #    and is swallowed by the `-` — reproducing the exact bug being fixed.
    local show path argv
    show="$(systemctl show "$RUNNER_UNIT" -p ExecStart --value 2>/dev/null || true)"
    path="$(sed -n 's/^{ path=\([^ ]*\) .*/\1/p' <<<"$show" | head -n1 || true)"
    argv="${show#*argv[]=}"
    argv="${argv%% ; *}"
    if [[ -n "$path" && -f "$path" && -x "$path" && "$argv" == "$path runner start-sync"* ]]; then
        printf -- '-%s runner stop' "$path"
        return 0
    fi

    # 4. Fleet/pet convention.
    if [[ -f /opt/hapi/hapi && -x /opt/hapi/hapi ]]; then
        printf -- '-/opt/hapi/hapi runner stop'
        return 0
    fi

    # No host-path guesses beyond this point. The previous hardcoded soup paths
    # are exactly what made this drop-in unportable; install-hapi-systemd-units.sh
    # passes --runner-stop-cmd for primary-soup, which knows the real layout.
    echo "ERROR: cannot determine how to stop the runner on this host." >&2
    echo "       The runner unit is not the single-exe shape and /opt/hapi/hapi" >&2
    echo "       is absent, so any guess could silently no-op." >&2
    echo "       Pass --runner-bin /path/to/hapi, or --runner-stop-cmd '<command>'" >&2
    echo "       for a wrapped entrypoint (bun, env, a shell)." >&2
    echo "       Refusing to install Restart=always without a working stop." >&2
    exit 1
}

RESOLVED_STOP_CMD="$(resolve_runner_stop_cmd)"
echo "Tier-1 runner stop command: $RESOLVED_STOP_CMD"

mkdir -p "$HUB_D" "$RUNNER_D"

# shellcheck source=lib/render-hapi-systemd-unit.sh
source "$REPO_ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh"
render_hapi_systemd_unit \
    "$SYS_D/10-resilience.conf.in" "$RUNNER_D/10-resilience.conf" \
    "RUNNER_STOP_CMD=$RESOLVED_STOP_CMD"
chmod 0644 "$RUNNER_D/10-resilience.conf"
install -m 0644 "$SYS_D/90-oom-protect-runner.conf" "$RUNNER_D/90-oom-protect-runner.conf"
install -m 0644 "$SYS_D/90-oom-protect-hub.conf" "$HUB_D/90-oom-protect-hub.conf"

# KillMode drop-in from earlier wave is redundant once 10-resilience is present;
# leave it if present (harmless duplicate KillMode=process).

# --- Watchdog identity ------------------------------------------------------
#
# All of this used to be hardcoded to the soup operator's account. On any other
# host ConditionPathExists could never be satisfied, so systemd SKIPPED the
# service on every fire while `systemctl list-timers` still showed the timer
# enabled — a watchdog that reports healthy and never runs.
#
# Default to the account the runner unit itself runs as; that is the account
# whose HAPI_HOME holds settings.json and whose sudo rule needs to exist.
if [[ -z "$WATCHDOG_USER" ]]; then
    WATCHDOG_USER="$(systemctl show "$RUNNER_UNIT" -p User --value 2>/dev/null || true)"
    WATCHDOG_USER="${WATCHDOG_USER:-root}"
fi
id -u "$WATCHDOG_USER" >/dev/null 2>&1 || {
    echo "ERROR: watchdog user '$WATCHDOG_USER' does not exist on this host." >&2
    echo "       Pass --watchdog-user. Installing a unit for a missing user" >&2
    echo "       would be skipped silently on every timer fire." >&2
    exit 1
}
if [[ -z "$WATCHDOG_HAPI_HOME" ]]; then
    WATCHDOG_HAPI_HOME="$(systemctl show-environment 2>/dev/null | sed -n 's/^HAPI_HOME=//p' | head -n1 || true)"
fi
if [[ -z "$WATCHDOG_HAPI_HOME" ]]; then
    # The runner unit carries HAPI_HOME in its own Environment=.
    WATCHDOG_HAPI_HOME="$(systemctl show "$RUNNER_UNIT" -p Environment --value 2>/dev/null \
        | tr ' ' '\n' | sed -n 's/^HAPI_HOME=//p' | head -n1 || true)"
fi
if [[ -z "$WATCHDOG_HAPI_HOME" ]]; then
    WATCHDOG_HAPI_HOME="$(getent passwd "$WATCHDOG_USER" | cut -d: -f6 || true)/.hapi"
fi
WATCHDOG_PORT="${WATCHDOG_PORT:-3006}"

# Install the watchdog where it will still exist on a host with no checkout of
# this repository — fleet and pet boxes run the single-exe and never clone it.
install -d -m 0755 "$WATCHDOG_LIBDIR" "$WATCHDOG_LIBDIR/lib"
install -m 0755 "$REPO_ROOT/scripts/tooling/hapi-runner-watchdog.sh" "$WATCHDOG_LIBDIR/hapi-runner-watchdog.sh"
install -m 0644 "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh" "$WATCHDOG_LIBDIR/lib/hapi-systemd-units.sh"

echo "Tier-1 watchdog: user=$WATCHDOG_USER home=$WATCHDOG_HAPI_HOME port=$WATCHDOG_PORT"

render_hapi_systemd_unit \
    "$SYS_D/hapi-runner-watchdog.service.in" /etc/systemd/system/hapi-runner-watchdog.service \
    "WATCHDOG_USER=$WATCHDOG_USER" \
    "HAPI_HOME=$WATCHDOG_HAPI_HOME" \
    "HAPI_PORT=$WATCHDOG_PORT" \
    "WATCHDOG_SCRIPT=$WATCHDOG_LIBDIR/hapi-runner-watchdog.sh"
chmod 0644 /etc/systemd/system/hapi-runner-watchdog.service
install -m 0644 "$SYS_D/hapi-runner-watchdog.timer" /etc/systemd/system/hapi-runner-watchdog.timer

# Sudoers: protect (deny hub destroy; allow runner restart) + watchdog NOPASSWD.
# Rendered for the same account — granting to a user the host does not have
# installs cleanly, passes visudo, and applies to nobody.
render_hapi_systemd_unit \
    "$REPO_ROOT/scripts/tooling/sudoers/hapi-protect.in" /etc/sudoers.d/hapi-protect \
    "SUDO_USER_NAME=$WATCHDOG_USER"
render_hapi_systemd_unit \
    "$REPO_ROOT/scripts/tooling/sudoers/hapi-watchdog.in" /etc/sudoers.d/hapi-watchdog \
    "SUDO_USER_NAME=$WATCHDOG_USER"
chmod 0440 /etc/sudoers.d/hapi-protect /etc/sudoers.d/hapi-watchdog
chown root:root /etc/sudoers.d/hapi-protect /etc/sudoers.d/hapi-watchdog
if ! visudo -cf /etc/sudoers.d/hapi-protect || ! visudo -cf /etc/sudoers.d/hapi-watchdog; then
    echo "ERROR: sudoers failed visudo -cf" >&2
    exit 1
fi

# Refresh systemctl wrapper (runner-restart allow path).
# Opt-in: this installs a system-wide /usr/local/sbin/systemctl that intercepts
# every sudo systemctl call on the box — materially broader than "harden the
# hapi units", and not something to inherit as a side effect of this script.
if [[ "$WITH_WRAPPER" -eq 1 ]]; then
    bash "$REPO_ROOT/scripts/tooling/install-systemctl-wrapper.sh"
else
    echo "Skipping systemctl wrapper (pass --with-systemctl-wrapper to install it)"
fi

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
