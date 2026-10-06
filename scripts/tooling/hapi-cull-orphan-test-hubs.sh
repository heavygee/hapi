#!/usr/bin/env bash
# hapi-cull-orphan-test-hubs — SIGTERM/SIGKILL runaway Vitest / ad-hoc test hub processes.
#
# Production hub (hapi-hub-oos.service / hapi-hub.service) is never matched.
# Targets bun processes running hub/src/index.ts with test markers or temp HAPI_HOME.
#
# Usage:
#   hapi-cull-orphan-test-hubs.sh              # dry-run (default)
#   hapi-cull-orphan-test-hubs.sh --kill       # SIGTERM then SIGKILL after grace
#   hapi-cull-orphan-test-hubs.sh --kill --min-cpu 30 --min-age-secs 600
#
# Env:
#   HAPI_TEST_HUB_CULL_MIN_CPU / HAPI_TEST_HUB_CULL_MIN_AGE_SECS
#   HAPI_TEST_HUB_CULL_NTFY_TOPIC (default: hapi-test-hub-cull)
#   NTFY_URL / NTFY_USER / NTFY_PASSWORD (from server-setup/.env)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$SCRIPT_DIR/lib/hapi-systemd-units.sh"

NTFY_ENV="${NTFY_ENV:-/home/heavygee/coding/server-setup/.env}"
NTFY_TOPIC="${HAPI_TEST_HUB_CULL_NTFY_TOPIC:-hapi-test-hub-cull}"
NTFY_URL="${NTFY_URL:-https://ntfy.introvrtlounge.com}"

MIN_CPU="${HAPI_TEST_HUB_CULL_MIN_CPU:-25}"
MIN_AGE_SECS="${HAPI_TEST_HUB_CULL_MIN_AGE_SECS:-600}"
GRACE_SECS="${HAPI_TEST_HUB_CULL_GRACE_SECS:-5}"
DO_KILL=0

HUB_UNIT="$(hapi_systemd_hub_unit)"
PROD_HUB_MAIN_PID=""
if systemctl is-active --quiet "$HUB_UNIT" 2>/dev/null; then
    PROD_HUB_MAIN_PID="$(systemctl show -p MainPID --value "$HUB_UNIT" 2>/dev/null || true)"
    [[ "$PROD_HUB_MAIN_PID" == "0" ]] && PROD_HUB_MAIN_PID=""
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --kill) DO_KILL=1; shift ;;
        --min-cpu) MIN_CPU="$2"; shift 2 ;;
        --min-age-secs) MIN_AGE_SECS="$2"; shift 2 ;;
        --help|-h)
            sed -n '2,16p' "$0"
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

etime_to_secs() {
    local et="$1" days=0 h=0 m=0 s=0
    if [[ "$et" =~ ^([0-9]+)-([0-9]{2}):([0-9]{2}):([0-9]{2})$ ]]; then
        days="${BASH_REMATCH[1]}"; h="${BASH_REMATCH[2]}"; m="${BASH_REMATCH[3]}"; s="${BASH_REMATCH[4]}"
    elif [[ "$et" =~ ^([0-9]{2}):([0-9]{2}):([0-9]{2})$ ]]; then
        h="${BASH_REMATCH[1]}"; m="${BASH_REMATCH[2]}"; s="${BASH_REMATCH[3]}"
    elif [[ "$et" =~ ^([0-9]{2}):([0-9]{2})$ ]]; then
        m="${BASH_REMATCH[1]}"; s="${BASH_REMATCH[2]}"
    else
        return 1
    fi
    echo $((10#$days * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s))
}

read_proc_env() {
    local pid="$1" key="$2"
    [[ -r "/proc/$pid/environ" ]] || return 0
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | awk -F= -v k="$key" '$1==k {print substr($0, index($0,"=")+1); exit}'
}

read_proc_cmd() {
    local pid="$1"
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | sed 's/  */ /g; s/ $//' || true
}

is_production_hub_tree() {
    local pid="$1"
    [[ -n "$PROD_HUB_MAIN_PID" ]] || return 1
    local cur="$pid"
    for _ in $(seq 1 20); do
        [[ "$cur" == "$PROD_HUB_MAIN_PID" ]] && return 0
        [[ -r "/proc/$cur/stat" ]] || break
        cur="$(awk '{print $4}' "/proc/$cur/stat" 2>/dev/null || echo 0)"
        [[ "$cur" == "0" || "$cur" == "1" ]] && break
    done
    return 1
}

looks_like_test_hub() {
    local pid="$1"
    local marker hapi_home listen_port
    marker="$(read_proc_env "$pid" HAPI_TEST_MARKER)"
    hapi_home="$(read_proc_env "$pid" HAPI_HOME)"
    listen_port="$(read_proc_env "$pid" HAPI_LISTEN_PORT)"
    if [[ -n "$marker" ]]; then
        return 0
    fi
    if [[ "$hapi_home" == /tmp/hapi-test-* || "$hapi_home" == /tmp/tmp.* ]]; then
        return 0
    fi
    # Ephemeral Vitest hubs bind loopback on a high port, not production :3006.
    if [[ -n "$listen_port" && "$listen_port" != "3006" && "$(read_proc_env "$pid" HAPI_LISTEN_HOST)" == "127.0.0.1" ]]; then
        return 0
    fi
    return 1
}

load_ntfy_env() {
    [[ -f "$NTFY_ENV" ]] || return 1
    local line key val
    while IFS= read -r line; do
        [[ "$line" =~ ^NTFY_[A-Z0-9_]+= ]] || continue
        key="${line%%=*}"
        val="${line#*=}"
        val="${val%\"}"; val="${val#\"}"
        export "${key}=${val}"
    done < <(grep '^NTFY_' "$NTFY_ENV" || true)
}

send_ntfy_kills() {
    local count="$1" body="$2"
    [[ "$count" -gt 0 ]] || return 0
    load_ntfy_env || { echo "ntfy: skip (no $NTFY_ENV)" >&2; return 0; }
    [[ -n "${NTFY_PASSWORD:-}" ]] || { echo "ntfy: skip (NTFY_PASSWORD unset)" >&2; return 0; }
    local user="${NTFY_USER:-heavygee}"
    local url="${NTFY_PUBLIC_URL:-https://ntfy.introvrtlounge.com}"
    curl -fsS -m 10 -u "${user}:${NTFY_PASSWORD}" \
        -H "Title: orphan test hub cull ($count killed)" \
        -H "Priority: high" \
        -H "Tags: skull,cpu" \
        -d "$body" \
        "${url%/}/${NTFY_TOPIC}" >/dev/null 2>&1 \
        && echo "ntfy: sent to ${NTFY_TOPIC}" \
        || echo "ntfy: publish failed (non-fatal)" >&2
}

matches=0
killed=0
kill_report=""

while read -r pid ppid cpu etime cmd; do
    [[ -n "$pid" ]] || continue
    [[ "$cmd" == *hub/src/index.ts* ]] || continue
    is_production_hub_tree "$pid" && continue
    looks_like_test_hub "$pid" || continue

    cpu_int="${cpu%%.*}"
    [[ "$cpu_int" -ge "$MIN_CPU" ]] || continue

    age_secs=0
    if ! age_secs="$(etime_to_secs "$etime" 2>/dev/null)"; then
        age_secs=0
    fi
    [[ "$age_secs" -ge "$MIN_AGE_SECS" ]] || continue

    marker="$(read_proc_env "$pid" HAPI_TEST_MARKER)"
    hapi_home="$(read_proc_env "$pid" HAPI_HOME)"
    listen_port="$(read_proc_env "$pid" HAPI_LISTEN_PORT)"

    echo "MATCH pid=$pid ppid=$ppid cpu=${cpu}% age=${age_secs}s port=${listen_port:-?}"
    echo "       HAPI_HOME=${hapi_home:-?} marker=${marker:-none}"
    echo "       $cmd"
    matches=$((matches + 1))

    if [[ "$DO_KILL" == "1" ]]; then
        if kill -TERM "$pid" 2>/dev/null; then
            sleep "$GRACE_SECS"
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
            if ! kill -0 "$pid" 2>/dev/null; then
                echo "       -> killed"
                killed=$((killed + 1))
                kill_report="${kill_report}pid=${pid} cpu=${cpu}% age=${age_secs}s home=${hapi_home:-?}"$'\n'
            else
                echo "       -> kill failed" >&2
            fi
        else
            echo "       -> SIGTERM failed (already gone?)" >&2
        fi
    fi
done < <(ps -eo pid=,ppid=,%cpu=,etime=,cmd= | awk '/hub\/src\/index\.ts/ {print}')

if [[ "$DO_KILL" == "1" ]]; then
    echo "hapi-cull-orphan-test-hubs: matched=$matches killed=$killed (min_cpu=${MIN_CPU} min_age=${MIN_AGE_SECS}s prod_unit=${HUB_UNIT})"
    if [[ "$killed" -gt 0 ]]; then
        host="$(hostname -s 2>/dev/null || hostname)"
        msg="host=${host} killed=${killed}/${matches} thresholds: cpu>=${MIN_CPU}% age>=${MIN_AGE_SECS}s
orphan Vitest / ad-hoc test hub processes (not ${HUB_UNIT})

${kill_report}
log: see cron or manual invocation"
        send_ntfy_kills "$killed" "$msg"
    fi
else
    echo "hapi-cull-orphan-test-hubs: matched=$matches (dry-run; pass --kill to terminate)"
fi
