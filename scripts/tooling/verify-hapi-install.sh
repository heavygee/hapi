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
dropin_paths=()
if [[ "$SCOPE" == system ]]; then
    dropin_paths+=("/etc/systemd/system/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
else
    dropin_paths+=("${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
    dropin_paths+=("$HOME/.config/systemd/user/${RUNNER_UNIT}.d/42-claude-oauth-token.conf")
fi
dropin_found=""
for d in "${dropin_paths[@]}"; do
    if [[ -f "$d" ]]; then
        dropin_found="$d"
        break
    fi
done
if [[ -n "$dropin_found" ]]; then
    ok "Claude OAuth drop-in present ($dropin_found)"
else
    not_ok "Claude OAuth drop-in present (expected 42-claude-oauth-token.conf under ${RUNNER_UNIT}.d)"
fi

env_files="$("${CTL[@]}" show "$RUNNER_UNIT" -p EnvironmentFiles --value 2>/dev/null || true)"
token_file_from_unit=""
if [[ "$env_files" == *claude-setup-token.env* ]]; then
    ok "runner EnvironmentFiles references claude-setup-token.env"
    # Extract path: systemd prints "path (ignore_errors=yes)" lines.
    token_file_from_unit="$(printf '%s\n' "$env_files" | tr ' ' '\n' | grep 'claude-setup-token\.env' | head -n1 || true)"
    token_file_from_unit="${token_file_from_unit%% (*}"
else
    not_ok "runner EnvironmentFiles references claude-setup-token.env (got: ${env_files:-empty})"
fi

# Prefer the path the unit actually loads; fall back to HAPI_HOME canonical only.
token_file="${token_file_from_unit:-}"
if [[ -z "$token_file" ]]; then
    token_file="$hapi_home/claude-setup-token.env"
fi

token_file_has_value=0
token_file_readable=0
if [[ -n "$token_file" ]]; then
    # Fleet tokens are 0600 hapi-owned; operator verify needs sudo -n (same as runner.state.json).
    # Require a non-whitespace value: CLAUDE_CODE_OAUTH_TOKEN=\r\n must NOT count as loaded
    # (grep '.' would treat CR as a value and disagree with Python's rstrip).
    token_line=""
    if [[ -r "$token_file" ]]; then
        token_line="$(grep -m1 $'^CLAUDE_CODE_OAUTH_TOKEN=[^[:space:]]' "$token_file" 2>/dev/null || true)"
        token_file_readable=1
    else
        set +e
        token_line="$(sudo -n grep -m1 $'^CLAUDE_CODE_OAUTH_TOKEN=[^[:space:]]' "$token_file" 2>/dev/null)"
        token_rc=$?
        set -e
        if [[ "$token_rc" -eq 0 ]]; then
            token_file_readable=1
        elif sudo -n test -e "$token_file" 2>/dev/null; then
            # File exists but value empty/whitespace — still readable via sudo.
            token_file_readable=1
        fi
    fi
    if [[ -n "$token_line" ]]; then
        token_file_has_value=1
        ok "Claude OAuth token file has CLAUDE_CODE_OAUTH_TOKEN= ($token_file)"
    elif [[ "$token_file_readable" -eq 0 && -e "$token_file" ]]; then
        inconclusive "Claude OAuth token file unreadable without sudo -n ($token_file) — re-run verify as root or with passwordless sudo"
    else
        # Fresh stranger install before setup-token — loud but not a hard fail unless
        # live peers prove the machine previously had a working token.
        inconclusive "Claude OAuth token file missing or empty (${token_file:-unknown}) — run claude setup-token and write CLAUDE_CODE_OAUTH_TOKEN=... then restart the runner"
    fi
else
    inconclusive "Claude OAuth token file missing or empty (unknown) — run claude setup-token and write CLAUDE_CODE_OAUTH_TOKEN=... then restart the runner"
fi

auth_probe_cmd=(python3)
if [[ "$main_pid" != "0" ]]; then
    if [[ ! -r "/proc/$main_pid/environ" ]]; then
        # Fleet: /proc/<hapi-pid>/environ is unreadable to the operator; sudo -n
        # is the check (same pattern as runner.state.json), not a recovery path.
        if sudo -n test -r "/proc/$main_pid/environ" 2>/dev/null; then
            auth_probe_cmd=(sudo -n python3)
        else
            auth_probe_cmd=()
        fi
    fi
fi

if [[ "$main_pid" != "0" && ${#auth_probe_cmd[@]} -gt 0 ]]; then
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

file_tok = None
file_key_seen = False
if token_file and os.path.isfile(token_file) and not os.path.islink(token_file):
    try:
        for line in open(token_file, "rb"):
            if line.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
                file_key_seen = True
                # Same nonempty rule as the shell probe: strip CR/LF/space so
                # CLAUDE_CODE_OAUTH_TOKEN=\r\n is missing, not a value.
                raw = line.split(b"=", 1)[1].strip()
                file_tok = raw if raw else None
                break
    except OSError:
        file_tok = None
        file_key_seen = False

# KillMode=process reparents session wrappers to init. Count same-uid hapi/claude
# peers that share this runner's HAPI_HOME (excludes interactive claude on
# primary-soup) OR are still in the MainPID descendant tree.
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
        same_instance = bool(runner_home) and peer_home == runner_home
        if not in_tree and not same_instance:
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
# Stale/empty file vs live runner: restart would drop or change ambient auth.
# Cover expect_load and empty assignments (=\r\n) even when shell no longer
# sets expect_load — never PASS when the file cannot reproduce runner_tok.
if runner_has and (expect_load or file_key_seen):
    if file_tok is None or runner_tok != file_tok:
        sys.exit(4)
# Reserve exit 0 for a real loaded ambient token — never PASS on runner=0.
if runner_has:
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
    inconclusive "runner Claude ambient token (no readable /proc/$main_pid/environ even via sudo -n)"
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
printf '# Fleet reads use sudo -n (token file + /proc environ) like runner.state.json.\n'
printf '# pass=%d fail=%d inconclusive=%d\n' "$PASS" "$FAIL" "$INCONCLUSIVE"
exit "$FAIL"
