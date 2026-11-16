#!/usr/bin/env bash
# hapi-runner-watchdog.sh
#
# Belt-and-braces watchdog: if THIS host's machine entry is missing from the
# hub's /api/machines list OR its runner.status is not "running", restart the
# hapi-runner.service systemd unit.
#
# Run by hapi-runner-watchdog.service (oneshot) on the schedule defined by
# hapi-runner-watchdog.timer. Logs to journald.
#
# Configuration via env vars (optionally loaded from
# /home/heavygee/.hapi/runner-watchdog.env by the service unit):
#
#   HAPI_API_URL          (default: http://127.0.0.1:3006)
#   CLI_API_TOKEN         (required - Bearer token for /api/machines)
#                         If missing, falls back to settings.json's cliApiToken.
#   HAPI_HOME             (default: ~/.hapi) - location of settings.json + runner.state.json
#   HAPI_WATCHDOG_DRY_RUN (default: empty) - if "1", log decision but don't actually restart
#   HAPI_WATCHDOG_GRACE_SEC (default: 30) - how recently runner.state.json must
#                         have been touched to be considered alive even if absent
#                         from the hub list (handles brief reconnect windows).
#
# Exit codes:
#   0 - runner healthy OR successfully restarted OR probe inconclusive
#   1 - probe + restart attempt both failed
#   2 - misconfigured (missing token, etc.) - RestartPreventExitStatus=2
#       in the unit catches this so we don't restart-loop on a config bug.
#
# History:
#   2026-05-31  Original (commit 720bb847) - probed /cli/machines/ which returns
#               SPA HTML, never worked. Read .lastHeartbeat from state.json which
#               does not exist in the schema.
#   2026-06-11  Restored + fixed: probes /api/machines, uses state.json mtime
#               directly for grace window. Confirmed working against live hub.

set -euo pipefail

log() {
    printf '%s [watchdog] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

HAPI_API_URL="${HAPI_API_URL:-http://127.0.0.1:3006}"
HAPI_HOME="${HAPI_HOME:-$HOME/.hapi}"
GRACE_SEC="${HAPI_WATCHDOG_GRACE_SEC:-30}"
SETTINGS_FILE="$HAPI_HOME/settings.json"
STATE_FILE="$HAPI_HOME/runner.state.json"

if [[ ! -f "$SETTINGS_FILE" ]]; then
    log "settings.json missing at $SETTINGS_FILE; nothing to do"
    exit 0
fi

CLI_TOKEN="${CLI_API_TOKEN:-}"
if [[ -z "$CLI_TOKEN" ]] && command -v jq >/dev/null; then
    CLI_TOKEN="$(jq -r '.cliApiToken // empty' "$SETTINGS_FILE" 2>/dev/null || true)"
fi
if [[ -z "$CLI_TOKEN" ]]; then
    log "ERROR: no CLI_API_TOKEN in env or settings.json (cliApiToken)"
    exit 2
fi

# Exchange cliApiToken for a Bearer JWT via /api/auth.
AUTH_RESP="$(curl -sS \
    --max-time 5 \
    -H 'Content-Type: application/json' \
    -d "{\"accessToken\":\"$CLI_TOKEN\"}" \
    "$HAPI_API_URL/api/auth" 2>/dev/null || true)"
TOKEN="$(echo "$AUTH_RESP" | jq -r '.token // empty' 2>/dev/null || true)"
if [[ -z "$TOKEN" ]]; then
    log "hub auth exchange failed at $HAPI_API_URL/api/auth; not restarting on probe failure"
    exit 0
fi

MACHINE_ID=""
if command -v jq >/dev/null; then
    MACHINE_ID="$(jq -r '.machineId // empty' "$SETTINGS_FILE" 2>/dev/null || true)"
fi
if [[ -z "$MACHINE_ID" ]]; then
    log "ERROR: no machineId in settings.json"
    exit 2
fi

# Probe the hub. /api/machines returns { "machines": [ ... ] }.
TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_RESP"' EXIT

HTTP_CODE="$(curl -sS \
    -o "$TMP_RESP" \
    -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    --max-time 5 \
    "$HAPI_API_URL/api/machines" 2>/dev/null || echo 'curl_fail')"

if [[ "$HTTP_CODE" == "curl_fail" || "$HTTP_CODE" != "200" ]]; then
    log "hub probe failed (HTTP $HTTP_CODE at $HAPI_API_URL/api/machines); not restarting on a failed probe"
    exit 0
fi

# --- freshness (code currency), separate from liveness -----------------------
#
# Stale iff the newest commit touching hub/ cli/ shared/ is NEWER than the
# moment the service started. Derived from live facts, so there is no stamp
# file to go stale, and a manual `systemctl restart` self-corrects.
#
# Deliberately conservative — it declines rather than restarts when unsure:
#   * a remat/promote in flight (restarting mid-promote is its own outage)
#   * any session currently WORKING (hapi-restart-hub drains, but do not even
#     ask while the estate is busy)
#   * another restart within the cooldown (a restart that does not clear the
#     staleness must not become a loop)
hapi_watchdog_check_freshness() {
    local driver="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
    local cooldown="${HAPI_WATCHDOG_FRESHNESS_COOLDOWN_SEC:-1800}"
    local marker="${HAPI_WATCHDOG_FRESHNESS_MARKER:-/var/lib/hapi/.watchdog-freshness-restart}"
    local unit code_at svc_at now

    [[ "${HAPI_WATCHDOG_FRESHNESS:-1}" == "1" ]] || return 0
    [[ -d "$driver/.git" || -f "$driver/.git" ]] || return 0

    # Newest commit touching code the services actually execute.
    code_at="$(git -C "$driver" log -1 --format=%ct -- hub cli shared 2>/dev/null || true)"
    [[ "$code_at" =~ ^[0-9]+$ ]] || return 0

    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hapi-systemd-units.sh" 2>/dev/null || return 0
    local primary; primary="$(hapi_systemd_runner_unit 2>/dev/null)" || return 0

    # EVERY runner unit on this host, not just the primary. The 2026-11-16
    # banner was hapi-runner-stars.service — a sandboxed zone runner execing
    # from the same soup tree, 13 days stale at CLI 0.31.6 while the tree was
    # 0.35.0. It cannot self-heal: HAPI_DISABLE_VERSION_HANDOFF=1 blocks
    # Upgrade, and it never sets HAPI_RUNNER_SUPERVISED=1 so the hub refuses
    # Restart too. Its unit says it "runs straight from the live soup tree",
    # so trailing the tree is a bug, not a pin. A sweep scoped to one unit
    # could never clear that banner.
    local units=() u
    while read -r u; do [[ -n "$u" ]] && units+=("$u"); done < <(
        systemctl list-units --type=service --state=active --no-legend 'hapi-runner-*.service' 2>/dev/null \
            | awk '{print $1}' | grep -v 'watchdog' || true
    )
    [[ ${#units[@]} -gt 0 ]] || units=("$primary")

    local stale=() 
    for u in "${units[@]}"; do
        svc_at="$(date -d "$(systemctl show -p ActiveEnterTimestamp --value "$u" 2>/dev/null)" +%s 2>/dev/null || true)"
        [[ "$svc_at" =~ ^[0-9]+$ ]] || continue
        if (( code_at > svc_at )); then
            stale+=("$u")
            log "FRESHNESS: $u started $(( (code_at - svc_at) / 60 ))min before the newest hub/cli/shared commit — running stale code"
        fi
    done
    [[ ${#stale[@]} -gt 0 ]] || return 0
    unit="${stale[0]}"

    if [[ -n "$(~/.local/bin/hapi-remat-hold status 2>/dev/null | grep -i 'ACTIVE' || true)" ]]; then
        log "FRESHNESS: remat hold active — deferring (promote in flight)"; return 0
    fi
    if ! ~/.local/bin/hapi-driver-status --quiet >/dev/null 2>&1; then
        log "FRESHNESS: driver busy (rebuild/switch in flight) — deferring"; return 0
    fi

    now="$(date +%s)"
    if [[ -f "$marker" ]]; then
        local last; last="$(stat -c '%Y' "$marker" 2>/dev/null || echo 0)"
        if (( now - last < cooldown )); then
            log "FRESHNESS: restarted $(( (now - last) / 60 ))min ago (cooldown ${cooldown}s) — deferring"; return 0
        fi
    fi

    if [[ "${HAPI_WATCHDOG_DRY_RUN:-}" == "1" ]]; then
        # Name the ACTUAL action per unit — the primary gets a patient
        # hapi-restart-hub, a zone runner gets a plain systemctl restart. A
        # dry run that misreports which of those it would do is worse than no
        # dry run, because it is read as reassurance.
        local u
        for u in "${stale[@]}"; do
            if [[ "$u" == "$primary" ]]; then
                log "FRESHNESS: DRY_RUN — would run hapi-restart-hub (patient; hub+$u)"
            elif hapi_watchdog_zone_busy "$u"; then
                log "FRESHNESS: DRY_RUN — $u stale but has live sessions; would defer"
            else
                log "FRESHNESS: DRY_RUN — would 'systemctl restart $u' (zone runner)"
            fi
        done
        return 0
    fi

    # Patient restart: drains WORKING agents, restarts hub AND runner together,
    # and finishes any deferred web/dist swap. Never a bare systemctl here.
    touch "$marker" 2>/dev/null || true
    local u
    for u in "${stale[@]}"; do
        if [[ "$u" == "$primary" ]]; then
            # Patient: drains WORKING agents and moves hub+runner together.
            if ~/.local/bin/hapi-restart-hub >/dev/null 2>&1; then
                log "FRESHNESS: hapi-restart-hub OK — $u now on current source"
            else
                log "FRESHNESS: ERROR hapi-restart-hub failed — will retry after cooldown"
            fi
            continue
        fi
        # Zone runner: hapi-restart-hub does not know about it. Skip while it
        # has live sessions rather than interrupt another zone's work.
        if hapi_watchdog_zone_busy "$u"; then
            log "FRESHNESS: $u has live sessions — deferring"
            continue
        fi
        if systemctl restart "$u" 2>/dev/null || sudo -n systemctl restart "$u" 2>/dev/null; then
            log "FRESHNESS: restarted $u — now on current source"
        else
            log "FRESHNESS: ERROR could not restart $u (permission?)"
        fi
    done
}

# True if the zone served by this unit has live sessions.
#
# Scoped to the unit's OWN machine, not the whole hub: an early version counted
# every active session, so a busy primary zone would have blocked the stars
# restart forever and it would never have self-healed. The unit's HOME maps to
# a machine via metadata.homeDir — the zone's own settings.json is unreadable
# from here (separate sandboxed user), but the hub already knows the mapping.
#
# Conservative: anything unresolved returns busy, so a lookup failure defers a
# restart rather than licensing one.
hapi_watchdog_zone_busy() {
    local unit="$1" home mid n
    home="$(systemctl show -p Environment --value "$unit" 2>/dev/null | tr ' ' '\n' \
            | grep -m1 '^HOME=' | cut -d= -f2-)"
    [[ -n "$home" ]] || return 0

    mid="$(sqlite3 "file:/var/lib/hapi/hapi.db?mode=ro" \
        "select id from machines where json_extract(metadata,'\$.homeDir')='$home' and active=1 limit 1;" \
        2>/dev/null || echo "")"
    [[ -n "$mid" ]] || return 0

    n="$(sqlite3 "file:/var/lib/hapi/hapi.db?mode=ro" \
        "select count(*) from sessions where active=1 and machine_id='$mid';" 2>/dev/null || echo "")"
    [[ "$n" =~ ^[0-9]+$ ]] || return 0
    (( n > 0 ))
}


# Look up THIS machine. Hub returns either a top-level array (older) or
# { "machines": [ ... ] } (current). runnerState.status is the live field.
HEALTHY="false"
if command -v jq >/dev/null; then
    HEALTHY="$(jq -r --arg mid "$MACHINE_ID" '
        (if type == "array" then . else (.machines // []) end)
        | map(select(.id == $mid))
        | if length == 0 then false
          else (.[0].runnerState.status // .[0].runner.status // "unknown") == "running"
          end
        | tostring
    ' "$TMP_RESP" 2>/dev/null || echo 'parse_fail')"
fi

if [[ "$HEALTHY" == "true" ]]; then
    # Alive is not the same as current. The foundry runner and hub exec from
    # SOURCE (`bun run src/index.ts runner`, WorkingDirectory=driver/cli), so
    # their "version" is whatever the driver tree held when the process
    # started. Nothing swaps a binary; the only upgrade is a service re-exec.
    # That is why the skew banner can SEE a stale runner and offer no action,
    # and why RunnerSelfUpgrade cannot help here — it installs an artifact the
    # systemd unit never runs.
    #
    # The promote path does restart, but it can lose the obligation: on
    # 2026-11-12 a promote changed hub/ then exited on a failed publish before
    # restarting, and the NEXT promote compared hub/cli/shared against the new
    # tip, saw no change, and skipped. The owed restart was erased and the hub
    # served 4-day-old code while every promote reported clean.
    #
    # So freshness is checked here instead: continuously, by something that is
    # always running, rather than by a deploy script that can exit early.
    # No stored state to drift — compares two facts available right now.
    hapi_watchdog_check_freshness
    log "machine $MACHINE_ID present + runner running on $HAPI_API_URL; no action"
    exit 0
fi

# Grace window: if runner.state.json was touched recently the runner is
# probably mid-startup or mid-reconnect. Skip restart in that window.
if [[ -f "$STATE_FILE" ]]; then
    LAST_MTIME="$(stat -c '%Y' "$STATE_FILE" 2>/dev/null || echo 0)"
    NOW="$(date +%s)"
    AGE=$((NOW - LAST_MTIME))
    if (( AGE < GRACE_SEC )); then
        log "machine $MACHINE_ID not healthy on hub but state.json ${AGE}s old (< grace ${GRACE_SEC}s); skipping restart"
        exit 0
    fi
    log "machine $MACHINE_ID absent or runner not running; state.json ${AGE}s stale"
else
    log "machine $MACHINE_ID absent or runner not running; no state file (runner not started)"
fi

# Bonus check before restart: if there IS a process at the recorded pid AND
# it's a hapi runner, the watchdog can't tell what's wrong from the outside.
# Restarting will at minimum re-register the machine with the hub.
if [[ -f "$STATE_FILE" ]] && command -v jq >/dev/null; then
    PID="$(jq -r '.pid // empty' "$STATE_FILE" 2>/dev/null || true)"
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
        log "(note: pid $PID is alive but unhealthy on hub - restart will re-register)"
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-systemd-units.sh
source "$SCRIPT_DIR/lib/hapi-systemd-units.sh"
RUNNER_UNIT="$(hapi_systemd_runner_unit)"

if [[ "${HAPI_WATCHDOG_DRY_RUN:-}" == "1" ]]; then
    log "DRY_RUN: would 'sudo systemctl restart $RUNNER_UNIT'"
    exit 0
fi

log "restarting $RUNNER_UNIT via systemctl"
# Prefer PATH systemctl (hits /usr/local/sbin wrapper which allows runner restart).
if systemctl restart "$RUNNER_UNIT" 2>/dev/null; then
    log "restart OK"
    exit 0
fi

if sudo -n systemctl restart "$RUNNER_UNIT" 2>/dev/null; then
    log "restart OK (via sudo)"
    exit 0
fi

# Absolute path bypasses the wrapper; still needs sudoers allow.
if sudo -n /bin/systemctl restart "$RUNNER_UNIT" 2>/dev/null; then
    log "restart OK (via sudo /bin/systemctl)"
    exit 0
fi

log "ERROR: could not restart $RUNNER_UNIT (permission? check /etc/sudoers.d/hapi-watchdog)"
exit 1
