#!/usr/bin/env bash
# verify-hapi-systemd-units.sh — assert KillMode/OOM/restart policy on this host.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

FAIL=0

ok() {
    printf 'OK: %s\n' "$1"
}

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    FAIL=1
}

HUB_UNIT="$(hapi_systemd_hub_unit)"
RUNNER_UNIT="$(hapi_systemd_runner_unit)"
SCOPE=system

if ! hapi_systemd_unit_exists "$HUB_UNIT"; then
    if [[ -f "$HOME/.config/systemd/user/hapi-hub.service" ]]; then
        HUB_UNIT=hapi-hub.service
        RUNNER_UNIT=hapi-runner.service
        SCOPE=user
    else
        echo "WARN: no system or user HAPI units found — nothing to verify" >&2
        exit 0
    fi
fi

show_prop() {
    local unit="$1"
    local prop="$2"
    if [[ "$SCOPE" == user ]]; then
        systemctl --user show "$unit" -p "$prop" --value 2>/dev/null || true
    else
        systemctl show "$unit" -p "$prop" --value 2>/dev/null || true
    fi
}

kill_mode="$(show_prop "$RUNNER_UNIT" KillMode)"
hub_oom="$(show_prop "$HUB_UNIT" OOMScoreAdjust)"
runner_oom="$(show_prop "$RUNNER_UNIT" OOMScoreAdjust)"
runner_restart="$(show_prop "$RUNNER_UNIT" Restart)"

if [[ "$kill_mode" == process ]]; then
    ok "runner KillMode=process ($RUNNER_UNIT)"
else
    fail "runner KillMode=process ($RUNNER_UNIT → $kill_mode)"
fi

if [[ "$SCOPE" == system ]] && hapi_systemd_unit_exists "$HUB_UNIT"; then
    if [[ "$hub_oom" == -1000 ]]; then
        ok "hub OOMScoreAdjust=-1000 ($HUB_UNIT)"
    else
        fail "hub OOMScoreAdjust=-1000 ($HUB_UNIT → $hub_oom)"
    fi
    if [[ "$runner_oom" == 0 ]]; then
        ok "runner OOMScoreAdjust=0 ($RUNNER_UNIT)"
    else
        fail "runner OOMScoreAdjust=0 ($RUNNER_UNIT → $runner_oom)"
    fi
fi

if [[ "$runner_restart" == always ]] || [[ "$runner_restart" == on-failure ]]; then
    ok "runner Restart policy ($runner_restart)"
else
    fail "runner Restart policy ($runner_restart)"
fi

if [[ "$SCOPE" == system ]] && systemctl is-enabled hapi-runner-watchdog.timer >/dev/null 2>&1; then
    if systemctl is-enabled hapi-runner-watchdog.timer >/dev/null 2>&1; then
        ok "watchdog timer enabled"
    else
        fail "watchdog timer not enabled"
    fi
fi

exit "$FAIL"
