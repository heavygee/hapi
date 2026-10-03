#!/usr/bin/env bash
# verify-hapi-install.sh — live assertions for a stranger-standing HAPI install.
#
# Extends (and calls) verify-hapi-systemd-units.sh for KillMode / ExecStartPre
# binary / configured OOM / Restart / watchdog ConditionPathExists-from-unit-text.
# Owns only what that verifier cannot prove: installer argument parse, watchdog
# journal fire, sudoers grants the runner account, systemctl wrapper present
# (default; HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER=1 if --no-systemctl-wrapper),
# MainPID ↔ runner.state.json after restart, live /proc oom_score_adj, hub /health,
# runner-vs-child Claude OAuth presence (token values never printed).
#
# Failure semantics (MainPID / sudoers): three outcomes, not two.
#   ok           — property under test held
#   not ok       — property under test failed (real mismatch / wrong grant)
#   inconclusive — could not observe the property (unreadable state, probe
#                  lacks privilege, async write not yet present). Loud, and
#                  does NOT increment FAIL. A false red here gets the check
#                  muted — same inverted disease as an enabled-timer false green.
#
# Trap: `systemctl show` returns defaults for units that do not exist (exit 0).
# Always prove the unit exists via `systemctl cat` / list-unit-files first.
#
# Usage:
#   bash scripts/tooling/verify-hapi-install.sh
#   bash scripts/tooling/verify-hapi-install.sh --installer-smoke --profile fleet-binary
#   bash scripts/tooling/verify-hapi-install.sh --skip-restart   # config-only
#
# Exit 0 = no hard failures (inconclusive allowed); 1 = at least one not-ok.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

PASS=0
FAIL=0
INCONCLUSIVE=0
SKIP_RESTART=0
INSTALLER_SMOKE=0
PROFILE=""
HUB_URL="${HAPI_VERIFY_HUB_URL:-http://127.0.0.1:3006}"
# runner.state.json is written asynchronously after restart; bound the wait.
STATE_PID_RETRIES="${HAPI_VERIFY_STATE_PID_RETRIES:-15}"
STATE_PID_SLEEP_S="${HAPI_VERIFY_STATE_PID_SLEEP_S:-1}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-restart) SKIP_RESTART=1; shift ;;
        --installer-smoke) INSTALLER_SMOKE=1; shift ;;
        --profile) PROFILE="${2:?}"; shift 2 ;;
        --hub-url) HUB_URL="${2:?}"; shift 2 ;;
        -h|--help)
            sed -n '2,25p' "$0" | sed 's/^# \?//'
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

inconclusive() {
    printf 'inconclusive - %s\n' "$1" >&2
    INCONCLUSIVE=$((INCONCLUSIVE + 1))
}

# Read runner.state.json pid into STATE_PID (not stdout — status must survive
# the call). Prefers direct read; falls through to `sudo -n cat` as part of the
# same check (not a follow-up). Sets STATE_READ_STATUS to:
#   got | empty | missing | unreadable
STATE_PID=""
STATE_READ_STATUS=""
read_runner_state_pid() {
    local f="$1"
    local raw=""
    STATE_PID=""
    STATE_READ_STATUS=missing
    if [[ ! -e "$f" ]]; then
        STATE_READ_STATUS=missing
        return 0
    fi
    if [[ -r "$f" ]]; then
        raw="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$f" 2>/dev/null || true)"
    else
        # Fleet: state owned by runner user; probe may lack read. sudo -n is the
        # check, not a recovery path after a not_ok.
        local sudo_out="" sudo_rc=0
        set +e
        sudo_out="$(sudo -n cat "$f" 2>/dev/null)"
        sudo_rc=$?
        set -e
        if [[ "$sudo_rc" -ne 0 ]]; then
            STATE_READ_STATUS=unreadable
            return 0
        fi
        raw="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("pid",""))' <<<"$sudo_out" 2>/dev/null || true)"
    fi
    raw="${raw//$'\n'/}"
    if [[ -z "$raw" ]]; then
        STATE_READ_STATUS=empty
        return 0
    fi
    STATE_PID="$raw"
    STATE_READ_STATUS=got
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

# --- 4. Sudoers grants the runner account (system scope) -------------------
# Primary path: read /etc/sudoers.d/hapi-watchdog directly. The file either
# names the runner User= or it does not. `sudo -l` needing a password for the
# probe user is environmental noise — not the property under test.
if [[ "$SCOPE" == system ]]; then
    runner_user="$("${CTL[@]}" show "$RUNNER_UNIT" -p User --value 2>/dev/null || true)"
    # Empty User= on an existing unit means root (systemd); we already proved
    # the unit exists via cat above.
    if [[ -z "$runner_user" ]]; then
        runner_user=root
    fi
    if ! id -u "$runner_user" >/dev/null 2>&1; then
        not_ok "sudoers grants runner user ($runner_user does not exist on this host)"
    else
        sudoers_file=/etc/sudoers.d/hapi-watchdog
        if [[ -r "$sudoers_file" ]]; then
            if grep -qE "^${runner_user}[[:space:]]" "$sudoers_file"; then
                ok "sudoers file grants $runner_user ($sudoers_file)"
            else
                not_ok "sudoers file grants $runner_user ($sudoers_file has no rule for that account)"
            fi
        elif [[ -f "$sudoers_file" ]]; then
            inconclusive "sudoers file grants $runner_user ($sudoers_file unreadable to probe — not a grant miss)"
        else
            not_ok "sudoers file grants $runner_user ($sudoers_file missing)"
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

# --- 6 + 7. Restart → active + MainPID match + live OOM + Claude auth + /health ----------
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

# Claude OAuth helpers needed before restart: a compromised runner with
# passwordless restart can plant a drop-in (User=root / ExecStart=…) that this
# verifier would otherwise execute. Source here (not at top) so --installer-smoke
# on archived trees still works.
# shellcheck source=lib/hapi-claude-oauth-dropin.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh"

SYSTEM_OAUTH_SAFE=1
OAUTH_RESTART_SAFE=1
SYSTEM_DROPIN_VALIDATED=""
SYSTEM_TOKEN_PRECHECKED=0
SYSTEM_TOKEN_NODE_CHECKED=0
if [[ "$SCOPE" == system ]]; then
    sys_dropin_dir="/etc/systemd/system/${RUNNER_UNIT}.d"
    sys_dropin="${sys_dropin_dir}/42-claude-oauth-token.conf"
    # Always validate the .d directory when it exists — a missing expected file
    # must not skip the gate (runner can plant 99-owned.conf before we restart).
    if [[ -e "$sys_dropin_dir" || -L "$sys_dropin_dir" ]]; then
        if ! hapi_claude_oauth_assert_root_controlled_parent "$sys_dropin_dir" >/dev/null 2>&1; then
            not_ok "Claude OAuth drop-in directory must be root-controlled ($sys_dropin_dir) — refusing restart"
            SYSTEM_OAUTH_SAFE=0
            OAUTH_RESTART_SAFE=0
        else
            ok "Claude OAuth drop-in directory is root-controlled ($sys_dropin_dir)"
        fi
    fi
    # systemd.unit(5): every *.conf in the unit .d directory is loaded. A
    # previously planted 99-owned.conf survives directory-mode repair and can
    # override User=/ExecStart= on the verifier's restart — gate every conf.
    if [[ -d "$sys_dropin_dir" && ! -L "$sys_dropin_dir" ]]; then
        shopt -s nullglob
        for conf in "$sys_dropin_dir"/*.conf; do
            if [[ -L "$conf" ]]; then
                not_ok "Claude OAuth drop-in dir has unsafe drop-in symlink ($conf) — refusing restart"
                SYSTEM_OAUTH_SAFE=0
                OAUTH_RESTART_SAFE=0
                continue
            fi
            if [[ ! -f "$conf" ]]; then
                not_ok "Claude OAuth drop-in dir has unsafe drop-in non-regular ($conf) — refusing restart"
                SYSTEM_OAUTH_SAFE=0
                OAUTH_RESTART_SAFE=0
                continue
            fi
            dropin_owner="$(stat -c '%U:%G' "$conf" 2>/dev/null || true)"
            dropin_mode="$(stat -c '%a' "$conf" 2>/dev/null || true)"
            if [[ "$dropin_owner" != "root:root" || "$dropin_mode" != "644" ]]; then
                not_ok "Claude OAuth drop-in dir has unsafe drop-in ($conf must be root:root 0644; got ${dropin_owner:-unknown} mode ${dropin_mode:-unknown}) — refusing restart"
                SYSTEM_OAUTH_SAFE=0
                OAUTH_RESTART_SAFE=0
                continue
            fi
            ok "Claude OAuth drop-in is root:root 0644 ($conf)"
            if [[ "$(basename "$conf")" == "42-claude-oauth-token.conf" ]]; then
                SYSTEM_DROPIN_VALIDATED="$conf"
            fi
        done
        shopt -u nullglob
    elif [[ -L "$sys_dropin" ]]; then
        not_ok "Claude OAuth drop-in is a symlink ($sys_dropin) — refusing restart"
        SYSTEM_OAUTH_SAFE=0
        OAUTH_RESTART_SAFE=0
    elif [[ -e "$sys_dropin" && ! -f "$sys_dropin" ]]; then
        not_ok "Claude OAuth drop-in is not a regular file ($sys_dropin) — refusing restart"
        SYSTEM_OAUTH_SAFE=0
        OAUTH_RESTART_SAFE=0
    fi

    # Canonical token node + parent before restart: systemd reads EnvironmentFile
    # as root; a symlink or service-writable /etc/hapi must not be loaded first.
    pre_token="/etc/hapi/claude-setup-token.env"
    pre_env_files="$("${CTL[@]}" show "$RUNNER_UNIT" -p EnvironmentFiles --value 2>/dev/null || true)"
    if [[ "$pre_env_files" == *claude-setup-token.env* ]]; then
        pre_from_unit="$(printf '%s\n' "$pre_env_files" | tr ' ' '\n' | grep 'claude-setup-token\.env' | head -n1 || true)"
        pre_from_unit="${pre_from_unit%% (*}"
        [[ -n "$pre_from_unit" ]] && pre_token="$pre_from_unit"
    fi
    pre_token_parent="$(dirname "$pre_token")"
    if [[ -d "$pre_token_parent" || -L "$pre_token_parent" ]]; then
        if ! hapi_claude_oauth_assert_root_controlled_parent "$pre_token_parent" >/dev/null 2>&1; then
            not_ok "Claude OAuth token parent must be root-controlled before restart ($pre_token_parent) — refusing restart"
            SYSTEM_OAUTH_SAFE=0
            OAUTH_RESTART_SAFE=0
        else
            ok "Claude OAuth token parent is root-controlled before restart ($pre_token_parent)"
            SYSTEM_TOKEN_PRECHECKED=1
        fi
    fi
    if [[ -L "$pre_token" ]]; then
        not_ok "Claude OAuth token file is a symlink ($pre_token) — refusing restart"
        SYSTEM_OAUTH_SAFE=0
        OAUTH_RESTART_SAFE=0
        SYSTEM_TOKEN_NODE_CHECKED=1
    elif [[ -e "$pre_token" && ! -f "$pre_token" ]]; then
        not_ok "Claude OAuth token file is not a regular file ($pre_token) — refusing restart"
        SYSTEM_OAUTH_SAFE=0
        OAUTH_RESTART_SAFE=0
        SYSTEM_TOKEN_NODE_CHECKED=1
    elif [[ -f "$pre_token" ]]; then
        SYSTEM_TOKEN_NODE_CHECKED=1
        pre_owner="$(stat -c '%U:%G' "$pre_token" 2>/dev/null || true)"
        pre_mode="$(stat -c '%a' "$pre_token" 2>/dev/null || true)"
        if [[ "$pre_owner" != "root:root" || "$pre_mode" != "600" ]]; then
            not_ok "Claude OAuth token file must be root:root 0600 before restart (got ${pre_owner:-unknown} mode ${pre_mode:-unknown} at $pre_token) — refusing restart"
            SYSTEM_OAUTH_SAFE=0
            OAUTH_RESTART_SAFE=0
        else
            ok "Claude OAuth token file is root:root 0600 before restart ($pre_token)"
            SYSTEM_TOKEN_PRECHECKED=1
        fi
    fi
fi

# Ambient-only guard (system + user): if MainPID still carries a token but the
# durable EnvironmentFile is missing/ineffective, restart would discard it
# before the later /proc probe can report split-brain.
pre_ambient_token=""
pre_env_files_all="$("${CTL[@]}" show "$RUNNER_UNIT" -p EnvironmentFiles --value 2>/dev/null || true)"
if [[ "$SCOPE" == system ]]; then
    pre_ambient_token="${pre_token:-/etc/hapi/claude-setup-token.env}"
elif [[ "$pre_env_files_all" == *claude-setup-token.env* ]]; then
    pre_ambient_token="$(printf '%s\n' "$pre_env_files_all" | tr ' ' '\n' | grep 'claude-setup-token\.env' | head -n1 || true)"
    pre_ambient_token="${pre_ambient_token%% (*}"
else
    pre_ambient_token="${hapi_home}/claude-setup-token.env"
fi
if ! hapi_claude_oauth_has_effective_token "${pre_ambient_token:-}" 2>/dev/null; then
    pre_runner_pid="$("${CTL[@]}" show "$RUNNER_UNIT" -p MainPID --value 2>/dev/null || echo 0)"
    pre_runner_pid="${pre_runner_pid:-0}"
    if [[ "$pre_runner_pid" != "0" && -r "/proc/$pre_runner_pid/environ" ]]; then
        pre_ambient_val=""
        while IFS= read -r -d '' pre_env_line || [[ -n "$pre_env_line" ]]; do
            case "$pre_env_line" in
                CLAUDE_CODE_OAUTH_TOKEN=*)
                    pre_ambient_val="${pre_env_line#CLAUDE_CODE_OAUTH_TOKEN=}"
                    ;;
            esac
        done <"/proc/$pre_runner_pid/environ"
        if [[ -n "$pre_ambient_val" ]]; then
            not_ok "runner MainPID=$pre_runner_pid has ambient CLAUDE_CODE_OAUTH_TOKEN but ${pre_ambient_token:-token file} is missing/empty — refusing restart"
            OAUTH_RESTART_SAFE=0
            SYSTEM_OAUTH_SAFE=0
        fi
    fi
fi

if [[ "$SKIP_RESTART" -eq 0 ]]; then
    if [[ "$OAUTH_RESTART_SAFE" -eq 0 ]]; then
        inconclusive "skipped hub/runner restart — OAuth drop-in/token/ambient safety checks failed"
    else
        "${CTL[@]}" restart "$HUB_UNIT" 2>/dev/null || true
        "${CTL[@]}" restart "$RUNNER_UNIT" 2>/dev/null || true
        # Give hub+runner a moment to write state
        for _ in $(seq 1 30); do
            active="$("${CTL[@]}" is-active "$RUNNER_UNIT" 2>/dev/null || true)"
            [[ "$active" == active ]] && break
            sleep 1
        done
    fi
fi

active="$("${CTL[@]}" is-active "$RUNNER_UNIT" 2>/dev/null || true)"
if [[ "$active" == active ]]; then
    ok "runner unit active after restart"
else
    not_ok "runner unit active after restart (is-active=$active)"
fi

main_pid="$("${CTL[@]}" show "$RUNNER_UNIT" -p MainPID --value 2>/dev/null || true)"
main_pid="${main_pid:-0}"

# Bounded retry: state is written asynchronously after restart. An immediate
# read can legitimately find no pid — that is inconclusive, not a mismatch.
# Distinguish "could not observe" from "observed different pid" (ninja class).
STATE_PID=""
STATE_READ_STATUS=missing
if [[ "$main_pid" != "0" ]]; then
    for _ in $(seq 1 "$STATE_PID_RETRIES"); do
        read_runner_state_pid "$state_file"
        if [[ "$STATE_READ_STATUS" == got ]]; then
            break
        fi
        if [[ "$STATE_READ_STATUS" == unreadable ]]; then
            # Privilege miss will not clear on retry — stop early.
            break
        fi
        # missing / empty: wait for async write
        sleep "$STATE_PID_SLEEP_S"
    done
fi

if [[ "$main_pid" == "0" ]]; then
    not_ok "MainPID equals runner.state.json pid (MainPID=0; unit not running)"
elif [[ "$STATE_READ_STATUS" == got && "$main_pid" == "$STATE_PID" ]]; then
    ok "MainPID equals runner.state.json pid ($main_pid)"
elif [[ "$STATE_READ_STATUS" == got ]]; then
    not_ok "MainPID equals runner.state.json pid (MainPID=$main_pid state=$STATE_PID) — unsupervised runner class"
elif [[ "$STATE_READ_STATUS" == unreadable ]]; then
    inconclusive "MainPID vs runner.state.json (state unreadable via sudo -n; MainPID=$main_pid) — not a mismatch"
elif [[ "$STATE_READ_STATUS" == missing ]]; then
    inconclusive "MainPID vs runner.state.json (no $state_file after ${STATE_PID_RETRIES}s; MainPID=$main_pid) — not a mismatch"
else
    inconclusive "MainPID vs runner.state.json (no pid field after ${STATE_PID_RETRIES}s; MainPID=$main_pid) — not a mismatch"
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

# --- Claude OAuth ambient token (drop-in + load + split-brain) ---------------
# UI POST /api/machines/:id/spawn does not send a per-spawn Claude token.
# New sessions inherit the runner ambient login. Missing EnvironmentFile load
# is the antevorta 2026-10-01 failure mode: --resume children still have the
# token, new UI sessions print Not logged in.
# Drop-in lib already sourced before restart (system safety gate).
dropin_paths=()
if [[ "$SCOPE" == system ]]; then
    dropin_paths+=("/etc/systemd/system/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
else
    dropin_paths+=("${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
    dropin_paths+=("$HOME/.config/systemd/user/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
fi
dropin_found=""
if [[ -n "${SYSTEM_DROPIN_VALIDATED:-}" ]]; then
    dropin_found="$SYSTEM_DROPIN_VALIDATED"
    # Presence + ownership already ok'd before restart — do not double-count.
elif [[ "$SCOPE" == system && "$SYSTEM_OAUTH_SAFE" -eq 0 ]]; then
    dropin_found=""  # already not_ok'd; skip a second presence failure
else
    for d in "${dropin_paths[@]}"; do
        # Prefer -e/-L over -f: -f follows symlinks and would accept a planted link.
        if [[ -L "$d" ]]; then
            not_ok "Claude OAuth drop-in is a symlink ($d)"
            dropin_found=""
            break
        elif [[ -e "$d" && ! -f "$d" ]]; then
            not_ok "Claude OAuth drop-in is not a regular file ($d)"
            dropin_found=""
            break
        elif [[ -f "$d" ]]; then
            dropin_found="$d"
            break
        fi
    done
    if [[ -n "$dropin_found" ]]; then
        ok "Claude OAuth drop-in present ($dropin_found)"
    elif [[ "$SCOPE" != system || "$SYSTEM_OAUTH_SAFE" -eq 1 ]]; then
        not_ok "Claude OAuth drop-in present (expected 42-claude-oauth-token.conf under ${RUNNER_UNIT}.d)"
    fi
fi

env_files="$("${CTL[@]}" show "$RUNNER_UNIT" -p EnvironmentFiles --value 2>/dev/null || true)"
token_file_from_unit=""
if [[ "$env_files" == *claude-setup-token.env* ]]; then
    # Extract path: systemd prints "path (ignore_errors=yes)" lines.
    token_file_from_unit="$(printf '%s\n' "$env_files" | tr ' ' '\n' | grep 'claude-setup-token\.env' | head -n1 || true)"
    token_file_from_unit="${token_file_from_unit%% (*}"
    if [[ "$SCOPE" == system ]]; then
        # System scope must use the root-controlled canonical path — a legacy
        # /var/lib/hapi/... basename match is not success for this change.
        if [[ "$token_file_from_unit" == "/etc/hapi/claude-setup-token.env" ]]; then
            ok "runner EnvironmentFiles uses canonical /etc/hapi/claude-setup-token.env"
        else
            not_ok "system runner EnvironmentFile must be /etc/hapi/claude-setup-token.env (got: ${token_file_from_unit:-empty})"
        fi
    else
        ok "runner EnvironmentFiles references claude-setup-token.env"
    fi
else
    not_ok "runner EnvironmentFiles references claude-setup-token.env (got: ${env_files:-empty})"
fi

# Prefer the path the unit actually loads; fall back by scope.
token_file="${token_file_from_unit:-}"
if [[ -z "$token_file" ]]; then
    if [[ "$SCOPE" == system ]]; then
        token_file="/etc/hapi/claude-setup-token.env"
    else
        token_file="$hapi_home/claude-setup-token.env"
    fi
fi

token_file_has_value=0
token_file_readable=0
if [[ -n "$token_file" ]]; then
    # Fleet tokens are root:root 0600 under /etc/hapi. Installed sudoers only
    # grant runner restart (hapi-watchdog.in) — not grep/test/python3. Do not
    # fake a sudo -n read. System-scope verify must run as root.
    # Symlink / non-regular nodes are hard failures (not "missing/empty").
    # System-scope already gated these before restart — do not double-count.
    if [[ "$SCOPE" == system && "${SYSTEM_TOKEN_NODE_CHECKED:-0}" -eq 1 && ( -L "$token_file" || ( -e "$token_file" && ! -f "$token_file" ) ) ]]; then
        : # already not_ok'd in pre-restart gate
    elif [[ -L "$token_file" ]]; then
        not_ok "Claude OAuth token file is a symlink ($token_file) — replace with a regular root:root 0600 file"
    elif [[ -e "$token_file" && ! -f "$token_file" ]]; then
        not_ok "Claude OAuth token file is not a regular file ($token_file) — replace with a regular root:root 0600 file"
    elif [[ -r "$token_file" ]]; then
        token_file_readable=1
        if hapi_claude_oauth_has_effective_token "$token_file"; then
            token_file_has_value=1
            ok "Claude OAuth token file has CLAUDE_CODE_OAUTH_TOKEN= ($token_file)"
            if [[ "$SCOPE" == system && "${SYSTEM_TOKEN_PRECHECKED:-0}" -eq 0 ]]; then
                token_owner="$(stat -c '%U:%G' "$token_file" 2>/dev/null || true)"
                token_mode="$(stat -c '%a' "$token_file" 2>/dev/null || true)"
                if [[ "$token_owner" == "root:root" && "$token_mode" == "600" ]]; then
                    ok "Claude OAuth token file is root:root 0600 ($token_file)"
                else
                    not_ok "Claude OAuth token file must be root:root 0600 (got ${token_owner:-unknown} mode ${token_mode:-unknown} at $token_file)"
                fi
            fi
        else
            inconclusive "Claude OAuth token file missing or empty (${token_file:-unknown}) — run claude setup-token and write CLAUDE_CODE_OAUTH_TOKEN=... then restart the runner"
        fi
    elif [[ "$SCOPE" == system && "${EUID:-$(id -u)}" -ne 0 ]]; then
        if [[ -e "$token_file" ]]; then
            not_ok "Claude OAuth token file unreadable as $(id -un) ($token_file) — re-run as root: sudo bash $REPO_ROOT/scripts/tooling/verify-hapi-install.sh"
        else
            inconclusive "Claude OAuth token file missing or empty (${token_file:-unknown}) — run claude setup-token then: printf 'CLAUDE_CODE_OAUTH_TOKEN=...\\n' | sudo install -m 0600 /dev/stdin $token_file && sudo systemctl restart the runner"
        fi
    elif [[ -e "$token_file" ]]; then
        inconclusive "Claude OAuth token file unreadable ($token_file)"
    else
        inconclusive "Claude OAuth token file missing or empty (${token_file:-unknown}) — run claude setup-token and write CLAUDE_CODE_OAUTH_TOKEN=... then restart the runner"
    fi
    # Parent dir must stay root-owned + not group/other-writable; otherwise the
    # service account can unlink/replace a root:root 0600 token after verify.
    # Capture helper stderr in-memory — never fixed /tmp paths.
    # Skip re-check when the pre-restart gate already validated the parent.
    if [[ "$SCOPE" == system && "${SYSTEM_TOKEN_PRECHECKED:-0}" -eq 0 ]]; then
        token_parent="$(dirname "$token_file")"
        if [[ -d "$token_parent" || -L "$token_parent" ]]; then
            parent_err=""
            if parent_err="$(hapi_claude_oauth_assert_root_controlled_parent "$token_parent" 2>&1)"; then
                ok "Claude OAuth token parent is root-controlled ($token_parent)"
            else
                not_ok "Claude OAuth token parent must be root-owned and not group/other-writable ($token_parent; ${parent_err:0:200})"
            fi
        fi
    fi
else
    inconclusive "Claude OAuth token file missing or empty (unknown) — run claude setup-token and write CLAUDE_CODE_OAUTH_TOKEN=... then restart the runner"
fi

# Bash fallback when python3 is absent (user-pet minimal hosts). Covers runner
# load + EnvironmentFile match; peer split-brain still needs python3 (hard-fail).
hapi_verify_claude_ambient_bash() {
    local pid="$1" expect_load="$2" token_path="$3"
    local runner_tok="" file_tok="" line=""
    if [[ ! -r "/proc/$pid/environ" ]]; then
        return 2
    fi
    # Last assignment wins in the process environ too (rare duplicates).
    while IFS= read -r -d '' line || [[ -n "$line" ]]; do
        case "$line" in
            CLAUDE_CODE_OAUTH_TOKEN=*)
                runner_tok="${line#CLAUDE_CODE_OAUTH_TOKEN=}"
                ;;
        esac
    done <"/proc/$pid/environ"
    if [[ -n "$token_path" && -f "$token_path" && ! -L "$token_path" ]]; then
        set +e
        file_tok="$(hapi_claude_oauth_effective_token_value "$token_path" 2>/dev/null)"
        set -e
    fi
    local runner_has=0
    [[ -n "$runner_tok" ]] && runner_has=1
    printf 'runner=%d peers=- expect_load=%d file_sha12=bash runner_sha12=bash home=bash\n' \
        "$runner_has" "$expect_load"
    if [[ "$expect_load" -eq 1 && "$runner_has" -eq 0 ]]; then
        return 3
    fi
    if [[ "$runner_has" -eq 1 ]]; then
        if [[ -z "$file_tok" || "$runner_tok" != "$file_tok" ]]; then
            return 4
        fi
        return 0
    fi
    return 5
}

auth_probe_cmd=(python3)
auth_probe_need_root=0
auth_probe_mode=python
if [[ "$main_pid" != "0" ]]; then
    if [[ ! -r "/proc/$main_pid/environ" ]]; then
        # Do not sudo -n python3: watchdog sudoers does not grant it.
        if [[ "$SCOPE" == system && "${EUID:-$(id -u)}" -ne 0 ]]; then
            not_ok "runner Claude ambient token unreadable as $(id -un) (/proc/$main_pid/environ) — re-run as root: sudo bash $REPO_ROOT/scripts/tooling/verify-hapi-install.sh"
            auth_probe_cmd=()
            auth_probe_need_root=1
        else
            auth_probe_cmd=()
        fi
    elif ! command -v python3 >/dev/null 2>&1; then
        if [[ "$SCOPE" == user ]]; then
            auth_probe_mode=bash
            auth_probe_cmd=()
        else
            # System verify already requires python3 for secure OAuth tooling.
            not_ok "python3 required to verify runner Claude ambient token (install python3 and re-run)"
            auth_probe_cmd=()
            auth_probe_need_root=1
        fi
    fi
fi

if [[ "$main_pid" != "0" && "$auth_probe_mode" == bash ]]; then
    set +e
    auth_out="$(hapi_verify_claude_ambient_bash "$main_pid" "$token_file_has_value" "${token_file:-}")"
    auth_rc=$?
    set -e
    if [[ "$auth_rc" -eq 0 ]]; then
        ok "runner Claude ambient token loaded ($auth_out)"
    elif [[ "$auth_rc" -eq 3 ]]; then
        not_ok "token file has CLAUDE_CODE_OAUTH_TOKEN but runner process did not load it ($auth_out; restart runner after installing drop-in)"
    elif [[ "$auth_rc" -eq 4 ]]; then
        not_ok "runner CLAUDE_CODE_OAUTH_TOKEN does not match EnvironmentFile ($auth_out; restart runner after rotating the token)"
    elif [[ "$auth_rc" -eq 5 ]]; then
        inconclusive "runner Claude ambient token not loaded yet ($auth_out) — write CLAUDE_CODE_OAUTH_TOKEN and restart the runner"
    else
        not_ok "runner Claude ambient token probe failed without python3 (rc=$auth_rc)"
    fi
elif [[ "$main_pid" != "0" && ${#auth_probe_cmd[@]} -gt 0 ]]; then
    set +e
    auth_out="$("${auth_probe_cmd[@]}" - "$main_pid" "$token_file_has_value" "${token_file:-}" "${hapi_home:-}" <<'PY'
import hashlib, os, sys
pid = sys.argv[1]
expect_load = sys.argv[2] == "1"
token_file = sys.argv[3] if len(sys.argv) > 3 else ""
expected_home = sys.argv[4] if len(sys.argv) > 4 else ""

def read_oauth_from_environ(path):
    try:
        for item in open(path, "rb").read().split(b"\0"):
            if item.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
                val = item.split(b"=", 1)[1]
                # Empty CLAUDE_CODE_OAUTH_TOKEN= is not a loaded ambient login.
                return val if val else None
    except OSError:
        return None
    return None

def read_env_var(path, key):
    prefix = key.encode("utf-8") + b"="
    try:
        for item in open(path, "rb").read().split(b"\0"):
            if item.startswith(prefix):
                return item.split(b"=", 1)[1].decode("utf-8", "replace")
    except OSError:
        return None
    return None

def sha12(raw):
    return hashlib.sha256(raw).hexdigest()[:12]

def real_uid(p):
    try:
        for line in open("/proc/%d/status" % p, "r", encoding="utf-8", errors="replace"):
            if line.startswith("Uid:"):
                return int(line.split()[1])
    except OSError:
        return None
    return None

def descendants(root):
    children = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        p = int(entry)
        try:
            for line in open("/proc/%d/status" % p, "r", encoding="utf-8", errors="replace"):
                if line.startswith("PPid:"):
                    pp = int(line.split()[1])
                    children.setdefault(pp, []).append(p)
                    break
        except OSError:
            continue
    out = {root}
    stack = [root]
    while stack:
        cur = stack.pop()
        for kid in children.get(cur, []):
            if kid not in out:
                out.add(kid)
                stack.append(kid)
    return out

try:
    runner_tok = read_oauth_from_environ("/proc/%s/environ" % pid)
except OSError:
    sys.exit(2)
runner_has = bool(runner_tok)
runner_uid = real_uid(int(pid))
runner_home = read_env_var("/proc/%s/environ" % pid, "HAPI_HOME") or expected_home
tree = descendants(int(pid))

def parse_env_file_value(raw):
    # Mirror systemd EnvironmentFile quoting (systemd.exec(5) / env-file.c):
    # strip outer whitespace, then unquote '...' / "..." so file_tok matches
    # what lands in the process environ (quotes are not part of the value).
    if raw is None:
        return None
    val = raw.strip()
    if not val:
        return None
    if len(val) >= 2 and val[0:1] == val[-1:] == b"'":
        return val[1:-1] or None
    if len(val) >= 2 and val[0:1] == val[-1:] == b'"':
        inner = val[1:-1]
        out = bytearray()
        i = 0
        while i < len(inner):
            if inner[i:i+1] == b"\\" and i + 1 < len(inner):
                nxt = inner[i+1:i+2]
                if nxt in (b"\\", b'"', b"`", b"$"):
                    out.extend(nxt)
                else:
                    out.extend(b"\\")
                    out.extend(nxt)
                i += 2
                continue
            out.extend(inner[i:i+1])
            i += 1
        return bytes(out) or None
    # Unquoted: leading/trailing whitespace already stripped; keep interior.
    # Minimal \\ escape so "\\n" stays two chars unless we see \\X keep X.
    out = bytearray()
    i = 0
    while i < len(val):
        if val[i:i+1] == b"\\" and i + 1 < len(val):
            out.extend(val[i+1:i+2])
            i += 2
            continue
        out.extend(val[i:i+1])
        i += 1
    return bytes(out) or None

file_tok = None
file_key_seen = False
if token_file and os.path.isfile(token_file) and not os.path.islink(token_file):
    try:
        # systemd applies the *last* assignment for a key; scan all lines.
        for line in open(token_file, "rb"):
            if line.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
                file_key_seen = True
                # Same nonempty rule as the shell probe after systemd unquote:
                # CLAUDE_CODE_OAUTH_TOKEN=\r\n / "" / '' are missing, not a value.
                file_tok = parse_env_file_value(line.split(b"=", 1)[1])
    except OSError:
        file_tok = None
        file_key_seen = False

# KillMode=process reparents session wrappers to init. Count same-uid hapi/claude
# peers that are still in the MainPID descendant tree, OR share HAPI_HOME *and*
# the runner's systemd cgroup (UID+HAPI_HOME alone matches interactive shells
# that sourced .bashrc on user-pet hosts).
def cgroup_paths(proc_pid):
    paths = []
    try:
        with open("/proc/%d/cgroup" % proc_pid, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.strip().split(":")
                if len(parts) >= 3 and parts[-1]:
                    paths.append(parts[-1])
    except OSError:
        pass
    return paths

def cgroup_related(runner_paths, peer_paths):
    for rp in runner_paths:
        if not rp or rp == "/":
            continue
        rp_norm = rp.rstrip("/")
        for pp in peer_paths:
            if not pp:
                continue
            pp_norm = pp.rstrip("/")
            if pp_norm == rp_norm or pp_norm.startswith(rp_norm + "/"):
                return True
    return False

runner_cgroups = cgroup_paths(int(pid))
peer_has = 0
if runner_uid is not None:
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        cpid = int(entry)
        if cpid == int(pid):
            continue
        if real_uid(cpid) != runner_uid:
            continue
        try:
            comm = open("/proc/%d/comm" % cpid, encoding="utf-8", errors="replace").read().strip()
        except OSError:
            continue
        if comm not in ("hapi", "claude"):
            continue
        in_tree = cpid in tree
        peer_home = read_env_var("/proc/%d/environ" % cpid, "HAPI_HOME")
        same_home = bool(runner_home) and peer_home == runner_home
        same_cgroup = cgroup_related(runner_cgroups, cgroup_paths(cpid))
        # Non-descendants need cgroup association — not HAPI_HOME alone.
        if not in_tree and not (same_home and same_cgroup):
            continue
        if read_oauth_from_environ("/proc/%d/environ" % cpid) is not None:
            peer_has += 1

file_h = sha12(file_tok) if file_tok else "-"
run_h = sha12(runner_tok) if runner_tok else "-"
print("runner=%d peers=%d expect_load=%d file_sha12=%s runner_sha12=%s home=%s" % (
    int(runner_has), peer_has, int(expect_load), file_h, run_h, runner_home or "-"))

# Split-brain: instance peers still carry a token, runner does not.
if peer_has and not runner_has:
    sys.exit(1)
# Token file claims a value but the running runner never loaded it.
if expect_load and not runner_has:
    sys.exit(3)
# Loaded ambient token must have a durable matching backing file — missing file,
# empty assignment, or mismatch all mean the next restart loses/changes auth.
if runner_has:
    if file_tok is None or runner_tok != file_tok:
        sys.exit(4)
    sys.exit(0)
# Fresh install / token not configured yet (no peers proving prior auth).
sys.exit(5)
PY
)"
    auth_rc=$?
    set -e
    if [[ "$auth_rc" -eq 0 ]]; then
        ok "runner Claude ambient token loaded ($auth_out)"
    elif [[ "$auth_rc" -eq 1 ]]; then
        not_ok "runner missing CLAUDE_CODE_OAUTH_TOKEN while same-instance Claude/hapi peers still have it ($auth_out; new UI spawns will /login)"
    elif [[ "$auth_rc" -eq 3 ]]; then
        not_ok "token file has CLAUDE_CODE_OAUTH_TOKEN but runner process did not load it ($auth_out; restart runner after installing drop-in)"
    elif [[ "$auth_rc" -eq 4 ]]; then
        not_ok "runner CLAUDE_CODE_OAUTH_TOKEN does not match EnvironmentFile ($auth_out; restart runner after rotating the token)"
    elif [[ "$auth_rc" -eq 5 ]]; then
        inconclusive "runner Claude ambient token not loaded yet ($auth_out) — write CLAUDE_CODE_OAUTH_TOKEN and restart the runner"
    else
        inconclusive "runner Claude ambient token (could not read /proc/$main_pid/environ)"
    fi
else
    if [[ "$auth_probe_need_root" -eq 0 ]]; then
        inconclusive "runner Claude ambient token (no readable /proc/$main_pid/environ)"
    fi
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

printf '\n# Claude auth: drop-in + EnvironmentFiles + /proc load + HAPI_HOME/descendant peer split-brain.\n'
printf '# Does not call Anthropic or print token values. Missing token file on a fresh box is inconclusive.\n'
printf '# System-scope OAuth file is root:root 0600; run verify as root (sudoers does not grant grep/python3).\n'
printf '# pass=%d fail=%d inconclusive=%d\n' "$PASS" "$FAIL" "$INCONCLUSIVE"
exit "$FAIL"
