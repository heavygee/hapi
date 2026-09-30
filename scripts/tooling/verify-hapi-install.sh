#!/usr/bin/env bash
# verify-hapi-install.sh — live assertions for a stranger-standing HAPI install.
#
# Extends (and calls) verify-hapi-systemd-units.sh for KillMode / ExecStartPre
# binary / configured OOM / Restart / watchdog ConditionPathExists-from-unit-text.
# Owns only what that verifier cannot prove: installer argument parse, watchdog
# journal fire, sudoers applies to a real account, systemctl wrapper present
# (default; HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER=1 if --no-systemctl-wrapper),
# MainPID ↔ runner.state.json after restart, live /proc oom_score_adj, hub /health.
#
# Trap: `systemctl show` returns defaults for units that do not exist (exit 0).
# Always prove the unit exists via `systemctl cat` / list-unit-files first.
#
# Usage:
#   bash scripts/tooling/verify-hapi-install.sh
#   bash scripts/tooling/verify-hapi-install.sh --installer-smoke --profile fleet-binary
#   bash scripts/tooling/verify-hapi-install.sh --skip-restart   # config-only
#
# Exit 0 = all applicable assertions passed; 1 = at least one failed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

PASS=0
FAIL=0
SKIP_RESTART=0
INSTALLER_SMOKE=0
PROFILE=""
HUB_URL="${HAPI_VERIFY_HUB_URL:-http://127.0.0.1:3006}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-restart) SKIP_RESTART=1; shift ;;
        --installer-smoke) INSTALLER_SMOKE=1; shift ;;
        --profile) PROFILE="${2:?}"; shift 2 ;;
        --hub-url) HUB_URL="${2:?}"; shift 2 ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

ok() {
    printf 'ok - %s\n' "$1"
    PASS=$((PASS + 1))
}

not_ok() {
    printf 'not ok - %s\n' "$1" >&2
    FAIL=$((FAIL + 1))
}

# --- 1. Installer smoke (optional; used for neg/pos SHA matrix) -------------
# `--installer-smoke` is smoke-ONLY: exit after this block. Full live verify is
# the default (no flag).
if [[ "$INSTALLER_SMOKE" -eq 1 ]]; then
    PROFILE="${PROFILE:-fleet-binary}"
    installer="$REPO_ROOT/scripts/tooling/install-hapi-systemd-units.sh"
    # Dry parse without root: success = get past source/arg-parse into profile
    # handling ("requires root" / unknown profile). Failure signature of the
    # 2026-09-30 bug: `ERROR: template not found: --profile`.
    set +e
    out2="$(bash "$installer" --profile "$PROFILE" 2>&1)"
    rc2=$?
    set -e
    if grep -q 'template not found: --profile' <<<"$out2"; then
        not_ok "installer --profile reaches validation (got template-not-found:--profile — source-\$@ bug)"
    elif grep -qE "unknown profile|requires root|ERROR: --profile required|^Profile: |^Installed:" <<<"$out2" \
        || [[ "$rc2" -eq 0 ]]; then
        ok "installer --profile reaches validation (profile=$PROFILE)"
    elif grep -q 'Failed to connect to bus' <<<"$out2"; then
        # user-pet got past parse/render into systemctl --user; bus missing in
        # this environment is not the source-\$@ bug.
        ok "installer --profile reaches validation (profile=$PROFILE, past parse into systemctl --user)"
    else
        not_ok "installer --profile reaches validation (unexpected: $(head -c 200 <<<"$out2"))"
    fi
    printf '# pass=%d fail=%d (installer-smoke only)\n' "$PASS" "$FAIL"
    exit "$FAIL"
fi

# Resolve scope / units — refuse to read properties of non-existent units.
HUB_UNIT="$(hapi_systemd_hub_unit)"
RUNNER_UNIT="$(hapi_systemd_runner_unit)"
SCOPE=system
CTL=(systemctl)

if hapi_systemd_unit_exists "$HUB_UNIT"; then
    :
elif [[ -f "$HOME/.config/systemd/user/hapi-hub.service" ]]; then
    HUB_UNIT=hapi-hub.service
    RUNNER_UNIT=hapi-runner.service
    SCOPE=user
    CTL=(systemctl --user)
else
    if [[ "$INSTALLER_SMOKE" -eq 1 ]]; then
        printf '# pass=%d fail=%d (installer-smoke only; no units on host)\n' "$PASS" "$FAIL"
        exit "$FAIL"
    fi
    not_ok "hapi hub unit exists (systemctl cat $HUB_UNIT / user unit)"
    printf '# pass=%d fail=%d\n' "$PASS" "$FAIL"
    exit 1
fi

# Prove unit exists before any `show` (defaults trap).
if ! "${CTL[@]}" cat "$RUNNER_UNIT" >/dev/null 2>&1; then
    not_ok "runner unit exists (${CTL[*]} cat $RUNNER_UNIT)"
    printf '# pass=%d fail=%d\n' "$PASS" "$FAIL"
    exit 1
fi
ok "runner unit exists ($RUNNER_UNIT, scope=$SCOPE)"

# Delegate KillMode / ExecStartPre-binary / configured OOM / Restart to the
# existing verifier. Map OK:/FAIL: → ok -/not ok - for a single footer.
VERIFY_UNITS="$REPO_ROOT/scripts/tooling/verify-hapi-systemd-units.sh"
if [[ -x "$VERIFY_UNITS" || -f "$VERIFY_UNITS" ]]; then
    set +e
    units_out="$(SCOPE_HINT="$SCOPE" HAPI_HUB_UNIT="$HUB_UNIT" HAPI_RUNNER_UNIT="$RUNNER_UNIT" \
        bash "$VERIFY_UNITS" 2>&1)"
    units_rc=$?
    set -e
    # Pass through #183's unit-text ConditionPathExists checks unchanged —
    # do not filter or re-implement them here.
    while IFS= read -r line; do
        case "$line" in
            OK:*) ok "${line#OK: }" ;;
            FAIL:*) not_ok "${line#FAIL: }" ;;
        esac
    done <<<"$units_out"
    # If verify-hapi-systemd-units exited non-zero but produced no FAIL lines, surface it.
    if [[ "$units_rc" -ne 0 ]] && ! grep -q '^FAIL:' <<<"$units_out"; then
        not_ok "verify-hapi-systemd-units.sh exit $units_rc"
    fi
fi

# --- 3. Watchdog journal fire (system scope) -------------------------------
# verify-hapi-systemd-units.sh already asserts ConditionPathExists from unit
# text. This layer only proves a live start left journal evidence. Fresh-box
# skip while settings.json is still absent (parent home exists) is a NOTE —
# the hub writes it on first start; the condition exists to keep the watchdog
# dormant until then.
if [[ "$SCOPE" == system ]]; then
    if "${CTL[@]}" cat hapi-runner-watchdog.service >/dev/null 2>&1; then
        cond="$("${CTL[@]}" show hapi-runner-watchdog.service -p ConditionResult --value 2>/dev/null || true)"
        wd_path="$("${CTL[@]}" cat hapi-runner-watchdog.service 2>/dev/null \
            | sed -n 's/^ConditionPathExists=//p' | tail -n1 || true)"
        wd_path="${wd_path#!}"
        # Kick once so a fresh install has journal evidence (idempotent).
        "${CTL[@]}" start hapi-runner-watchdog.service 2>/dev/null || true
        sleep 1
        set +e
        journal="$("${CTL[@]}" status hapi-runner-watchdog.service --no-pager -n 20 2>&1)"
        jlog="$(journalctl -u hapi-runner-watchdog.service -n 30 --no-pager 2>&1)"
        set -e
        if grep -qiE 'Condition.*failed|start condition failed' <<<"$journal$jlog"; then
            if [[ -n "$wd_path" && "$wd_path" == */settings.json \
                && -d "$(dirname "$wd_path")" && ! -e "$wd_path" ]]; then
                ok "watchdog dormant until settings.json (NOTE: first fire skip expected on fresh box; $wd_path)"
            else
                not_ok "watchdog executed (condition failed — service skipped every fire; path=$wd_path)"
            fi
        elif grep -qiE 'Main PID:|Started |code=exited|status=0' <<<"$journal$jlog" \
            || [[ "$cond" == "yes" ]]; then
            ok "watchdog executed (journal/ConditionResult=$cond)"
        else
            not_ok "watchdog executed (no journal evidence; ConditionResult=$cond)"
        fi
    else
        not_ok "watchdog unit exists (hapi-runner-watchdog.service)"
    fi
else
    ok "watchdog N/A for user-pet scope (system timer not expected)"
fi

# --- 4. Sudoers applies to a real account (system scope) -------------------
if [[ "$SCOPE" == system ]]; then
    runner_user="$("${CTL[@]}" show "$RUNNER_UNIT" -p User --value 2>/dev/null || true)"
    runner_user="${runner_user:-root}"
    if [[ -z "$runner_user" ]]; then
        not_ok "sudoers applies to runner user (empty User= on $RUNNER_UNIT)"
    elif ! id -u "$runner_user" >/dev/null 2>&1; then
        not_ok "sudoers applies to runner user ($runner_user does not exist)"
    else
        set +e
        sudo_l="$(sudo -n -l -U "$runner_user" 2>&1)"
        set -e
        if grep -qE 'hapi-runner|NOPASSWD.*systemctl.*(restart|start).*hapi-runner' <<<"$sudo_l"; then
            ok "sudoers applies to $runner_user (runner-restart visible in sudo -l)"
        elif [[ -f /etc/sudoers.d/hapi-watchdog ]] && grep -qE "^${runner_user}[[:space:]]" /etc/sudoers.d/hapi-watchdog; then
            # File grants the right user even if sudo -l needs a password for the probe user
            ok "sudoers file grants $runner_user (/etc/sudoers.d/hapi-watchdog)"
        else
            not_ok "sudoers applies to $runner_user (sudo -l / sudoers.d miss)"
        fi
    fi
else
    ok "sudoers N/A for user-pet scope"
fi

# --- 5. Systemctl wrapper (default install; --no-systemctl-wrapper to opt out)
# Flipped 2026-09-30: opt-in broke verify-hapi-operator-lock.sh, so the wrapper
# installs by default again. Assert present unless the operator opted out.
if [[ "$SCOPE" == system ]]; then
    if [[ -x /usr/local/sbin/systemctl ]]; then
        ok "systemctl wrapper present (/usr/local/sbin/systemctl)"
    elif [[ "${HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER:-0}" == "1" ]]; then
        ok "systemctl wrapper absent (HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER=1)"
    else
        not_ok "systemctl wrapper present (/usr/local/sbin/systemctl missing; set HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER=1 if --no-systemctl-wrapper)"
    fi
else
    ok "systemctl wrapper N/A for user-pet scope"
fi

# --- 6 + 7. Restart → active + MainPID match + live OOM + /health ----------
hapi_home="$("${CTL[@]}" show "$RUNNER_UNIT" -p Environment --value 2>/dev/null \
    | tr ' ' '\n' | sed -n 's/^HAPI_HOME=//p' | head -n1 || true)"
if [[ -z "$hapi_home" ]]; then
    if [[ "$SCOPE" == user ]]; then
        hapi_home="${HAPI_HOME:-$HOME/.hapi}"
    else
        hapi_home="${HAPI_HOME:-/var/lib/hapi}"
    fi
fi
state_file="$hapi_home/runner.state.json"

if [[ "$SKIP_RESTART" -eq 0 ]]; then
    "${CTL[@]}" restart "$HUB_UNIT" 2>/dev/null || true
    "${CTL[@]}" restart "$RUNNER_UNIT" 2>/dev/null || true
    # Give hub+runner a moment to write state
    for _ in $(seq 1 30); do
        active="$("${CTL[@]}" is-active "$RUNNER_UNIT" 2>/dev/null || true)"
        [[ "$active" == active ]] && break
        sleep 1
    done
fi

active="$("${CTL[@]}" is-active "$RUNNER_UNIT" 2>/dev/null || true)"
if [[ "$active" == active ]]; then
    ok "runner unit active after restart"
else
    not_ok "runner unit active after restart (is-active=$active)"
fi

main_pid="$("${CTL[@]}" show "$RUNNER_UNIT" -p MainPID --value 2>/dev/null || true)"
main_pid="${main_pid:-0}"
state_pid=""
if [[ -r "$state_file" ]]; then
    state_pid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$state_file" 2>/dev/null || true)"
elif [[ -f "$state_file" ]]; then
    # Fleet: state is owned by the runner user; probe may lack read.
    state_pid="$(sudo -n cat "$state_file" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pid",""))' 2>/dev/null || true)"
fi
if [[ -n "$state_pid" && "$main_pid" != "0" && "$main_pid" == "$state_pid" ]]; then
    ok "MainPID equals runner.state.json pid ($main_pid)"
elif [[ "$main_pid" == "0" ]]; then
    not_ok "MainPID equals runner.state.json pid (MainPID=0; unit not running)"
elif [[ -z "$state_pid" ]]; then
    not_ok "MainPID equals runner.state.json pid (no pid in $state_file; MainPID=$main_pid)"
else
    not_ok "MainPID equals runner.state.json pid (MainPID=$main_pid state=$state_pid) — unsupervised runner class"
fi

# Live OOM — config updates on daemon-reload; running processes do not.
if [[ "$main_pid" != "0" && -r "/proc/$main_pid/oom_score_adj" ]]; then
    live_oom="$(cat "/proc/$main_pid/oom_score_adj")"
    configured="$("${CTL[@]}" show "$RUNNER_UNIT" -p OOMScoreAdjust --value 2>/dev/null || true)"
    if [[ -n "$configured" && "$live_oom" == "$configured" ]]; then
        ok "live runner oom_score_adj=$live_oom (matches unit)"
    else
        not_ok "live runner oom_score_adj (live=$live_oom configured=$configured)"
    fi
else
    not_ok "live runner oom_score_adj (no /proc/$main_pid)"
fi

hub_pid="$("${CTL[@]}" show "$HUB_UNIT" -p MainPID --value 2>/dev/null || true)"
hub_pid="${hub_pid:-0}"
if [[ "$SCOPE" == system && "$hub_pid" != "0" && -r "/proc/$hub_pid/oom_score_adj" ]]; then
    live_hub_oom="$(cat "/proc/$hub_pid/oom_score_adj")"
    if [[ "$live_hub_oom" == "-1000" ]]; then
        ok "live hub oom_score_adj=-1000"
    else
        not_ok "live hub oom_score_adj=-1000 (live=$live_hub_oom)"
    fi
fi

set +e
health="$(curl -fsS -m 5 "$HUB_URL/health" 2>&1)"
health_rc=$?
set -e
if [[ "$health_rc" -eq 0 ]] && grep -q '"status":"ok"\|"status": "ok"' <<<"$health"; then
    ok "hub /health ok ($HUB_URL)"
else
    not_ok "hub /health ok ($HUB_URL → rc=$health_rc $(head -c 120 <<<"$health"))"
fi

printf '\n# Explicit gap: agent CLI / Claude auth NOT tested (pet installer leaves login to the operator).\n'
printf '# This check proves supervision + hub HTTP, not the ninja "sessions cascade on restart" class.\n'
printf '# pass=%d fail=%d\n' "$PASS" "$FAIL"
exit "$FAIL"
