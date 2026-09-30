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

# A runner-stop ExecStartPre that cannot execute is worse than none: with
# Restart=always the restart hits the runner's dedup path (exit 0), systemd
# retries, and the unit burns its start limit and lands in `failed` with an
# unsupervised runner still alive. This went unnoticed for months because
# systemd's `-` prefix (and the older `|| true`) hide the failure at runtime
# and the drop-in still *looks* installed. So assert the binary exists, not
# merely that the directive is present.
exec_start_pre="$(show_prop "$RUNNER_UNIT" ExecStartPre)"
restart_policy="$(show_prop "$RUNNER_UNIT" Restart)"

# A unit can carry several ExecStartPre entries (cursor-auth pinning, etc.), so
# pick the one that actually performs the runner stop rather than the first —
# validating the wrong entry would pass while the stop stays broken.
# `|| true`: grep exits 1 when there is no stop entry, and under `set -o
# pipefail` that would abort the whole verifier instead of reporting.
stop_entry="$(tr '}' '\n' <<<"$exec_start_pre" | grep -F 'runner stop' | head -n1 || true)"

if [[ -z "$stop_entry" ]]; then
    if [[ "$restart_policy" == always ]]; then
        fail "runner ExecStartPre runner-stop present ($RUNNER_UNIT → none, with Restart=always)"
    else
        ok "runner ExecStartPre runner-stop not required ($RUNNER_UNIT, Restart=$restart_policy)"
    fi
else
    # The stop may be a direct binary (-/opt/hapi/hapi runner stop) or wrapped in
    # a shell (bash -lc '<bun> ... runner stop'). For the wrapped form the shell
    # always exists, so check the real interpreter inside the command instead.
    argv="${stop_entry#*argv[]=}"
    argv="${argv%% ; *}"
    pre_bin="$(awk '{print $1}' <<<"$argv")"
    case "$pre_bin" in
        /bin/bash|/bin/sh|/usr/bin/bash|/usr/bin/sh|/usr/bin/env)
            # Wrapped: the first absolute path after the shell flags is the one
            # that has to exist on this host.
            pre_bin="$(grep -oE '(^| )/[^ ]+' <<<"$argv" | awk 'NR>1 {print $1; exit}' | tr -d ' ' || true)"
            ;;
    esac
    if [[ -n "$pre_bin" && -x "$pre_bin" ]]; then
        ok "runner ExecStartPre runner-stop executable ($pre_bin)"
    else
        fail "runner ExecStartPre runner-stop binary missing ($RUNNER_UNIT → ${pre_bin:-unparsed}) — stop silently no-ops"
    fi
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
