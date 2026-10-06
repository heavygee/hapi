# driver-remat-hold.sh — fail-closed soup remat escalation hold.
#
# When rematerialize fails (conflict, post-promote rollback, etc.), set a hold
# so no other agent can mutate soup until the designated escalator clears it.
#
# Hold file: ~/.hapi/remat-hold.json
# Config:    $PRIMARY/config/remat-escalate.yaml (or HAPI_REMAT_ESCALATE_CONFIG)
#
# Exit codes used by callers:
#   76  remat hold active (EX_NOPERM-ish; distinct from 75 busy)
#
# Bypass (owner):
#   HAPI_REMAT_OWNER=1
#   + HAPI_REMAT_OWNER_TOKEN matching ~/.config/hapi/remat-owner.token
#   + session/label match config/remat-escalate.yaml
# Operator TTY clear/bypass:
#   HAPI_OPERATOR_REMAT_HOLD_CLEAR=1  and controlling tty ([ -t 0 ])
#
# Token file is machine-local (not git). Same-UID agents can still read it —
# the token stops casual env forging of labels; abuse remains a kill-criterion.

HAPI_STATE_DIR="${HAPI_STATE_DIR:-$HOME/.hapi}"
HAPI_REMAT_HOLD_FILE="${HAPI_REMAT_HOLD_FILE:-$HAPI_STATE_DIR/remat-hold.json}"
HAPI_PRIMARY_FOR_HOLD="${HAPI_PRIMARY:-$HOME/coding/hapi}"
HAPI_REMAT_ESCALATE_CONFIG="${HAPI_REMAT_ESCALATE_CONFIG:-$HAPI_PRIMARY_FOR_HOLD/config/remat-escalate.yaml}"
HAPI_REMAT_OWNER_TOKEN_FILE="${HAPI_REMAT_OWNER_TOKEN_FILE:-$HOME/.config/hapi/remat-owner.token}"

_driver_remat_hold_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

_driver_remat_hold_ensure_dir() {
    mkdir -p "$HAPI_STATE_DIR"
}

# Load escalate config into globals (best-effort; defaults if missing).
# Env HAPI_REMAT_OWNER_PREFIX / _LABELS / _PING_CMD win if already set.
_driver_remat_hold_load_config() {
    local cfg="$HAPI_REMAT_ESCALATE_CONFIG"
    local prefix="5bcf291c" ping="hapi-ping-peer 5bcf291c" labels="meta-soup meta-soup-stabilize tooling-meta"
    local line key val in_labels=0

    if [[ -f "$cfg" ]]; then
        in_labels=0
        labels=""
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line//[[:space:]]/}" ]] && continue
            if [[ "$line" =~ ^owner_session_prefix:[[:space:]]*(.*) ]]; then
                val="${BASH_REMATCH[1]}"
                val="${val%%#*}"
                val="${val//\"/}"
                val="${val//\'/}"
                val="${val#"${val%%[![:space:]]*}"}"
                val="${val%"${val##*[![:space:]]}"}"
                [[ -n "$val" ]] && prefix="$val"
                in_labels=0
                continue
            fi
            if [[ "$line" =~ ^ping_cmd:[[:space:]]*(.*) ]]; then
                val="${BASH_REMATCH[1]}"
                val="${val%%#*}"
                val="${val#"${val%%[![:space:]]*}"}"
                val="${val%"${val##*[![:space:]]}"}"
                val="${val#\"}"; val="${val%\"}"
                val="${val#\'}"; val="${val%\'}"
                [[ -n "$val" ]] && ping="$val"
                in_labels=0
                continue
            fi
            if [[ "$line" =~ ^owner_labels:[[:space:]]*$ ]]; then
                in_labels=1
                continue
            fi
            if (( in_labels )); then
                if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
                    val="${BASH_REMATCH[1]}"
                    val="${val%%#*}"
                    val="${val#"${val%%[![:space:]]*}"}"
                    val="${val%"${val##*[![:space:]]}"}"
                    val="${val#\"}"; val="${val%\"}"
                    val="${val#\'}"; val="${val%\'}"
                    [[ -n "$val" ]] && labels="${labels:+$labels }$val"
                    continue
                fi
                if [[ "$line" =~ ^[^[:space:]] ]]; then
                    in_labels=0
                fi
            fi
        done <"$cfg"
        [[ -n "$labels" ]] || labels="meta-soup meta-soup-stabilize tooling-meta"
    fi

    HAPI_REMAT_OWNER_PREFIX="${HAPI_REMAT_OWNER_PREFIX:-$prefix}"
    HAPI_REMAT_OWNER_LABELS="${HAPI_REMAT_OWNER_LABELS:-$labels}"
    HAPI_REMAT_PING_CMD="${HAPI_REMAT_PING_CMD:-$ping}"
}

driver_remat_hold_active() {
    [[ -f "$HAPI_REMAT_HOLD_FILE" ]] || return 1
    command -v jq >/dev/null 2>&1 || return 1
    [[ "$(jq -r '.active // false' "$HAPI_REMAT_HOLD_FILE" 2>/dev/null)" == "true" ]]
}

# Create or rotate the machine-local owner token (chmod 600).
driver_remat_hold_init_owner_token() {
    local force="${1:-}"
    mkdir -p "$(dirname "$HAPI_REMAT_OWNER_TOKEN_FILE")"
    if [[ -f "$HAPI_REMAT_OWNER_TOKEN_FILE" && "$force" != "--force" ]]; then
        echo "Owner token already exists: $HAPI_REMAT_OWNER_TOKEN_FILE" >&2
        echo "Rotate with: hapi-remat-hold init-owner --force" >&2
        return 0
    fi
    local token
    token="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | xxd -p -c 48)"
    umask 077
    printf '%s\n' "$token" >"$HAPI_REMAT_OWNER_TOKEN_FILE"
    chmod 600 "$HAPI_REMAT_OWNER_TOKEN_FILE"
    echo "Wrote remat owner token: $HAPI_REMAT_OWNER_TOKEN_FILE" >&2
    echo "Meta remat under hold:" >&2
    echo "  export HAPI_REMAT_OWNER=1" >&2
    echo "  export HAPI_REMAT_OWNER_TOKEN=\$(cat $HAPI_REMAT_OWNER_TOKEN_FILE)" >&2
    echo "  export HAPI_AGENT_LABEL=meta-soup" >&2
    echo "  hapi-driver-rebuild --build-web --verify" >&2
}

# True if HAPI_REMAT_OWNER_TOKEN matches the on-disk token file.
driver_remat_hold_token_ok() {
    local expected presented
    if [[ ! -f "$HAPI_REMAT_OWNER_TOKEN_FILE" ]]; then
        echo "ERROR: remat owner token missing — run: hapi-remat-hold init-owner" >&2
        return 1
    fi
    expected="$(tr -d '[:space:]' <"$HAPI_REMAT_OWNER_TOKEN_FILE")"
    presented="$(printf '%s' "${HAPI_REMAT_OWNER_TOKEN:-}" | tr -d '[:space:]')"
    if [[ -z "$presented" ]]; then
        echo "ERROR: HAPI_REMAT_OWNER_TOKEN unset (need contents of $HAPI_REMAT_OWNER_TOKEN_FILE)" >&2
        return 1
    fi
    if [[ "$presented" != "$expected" ]]; then
        echo "ERROR: HAPI_REMAT_OWNER_TOKEN does not match $HAPI_REMAT_OWNER_TOKEN_FILE" >&2
        return 1
    fi
    return 0
}

# True if caller may remat/clear while hold is active.
driver_remat_hold_is_owner() {
    _driver_remat_hold_load_config

    # Operator TTY emergency (same pattern as systemctl override).
    if [[ "${HAPI_OPERATOR_REMAT_HOLD_CLEAR:-}" == "1" ]]; then
        if [[ -t 0 ]]; then
            return 0
        fi
        echo "NOTE: HAPI_OPERATOR_REMAT_HOLD_CLEAR ignored (no controlling tty)" >&2
    fi

    [[ "${HAPI_REMAT_OWNER:-}" == "1" ]] || return 1

    # Hard token — forged labels alone are not enough.
    driver_remat_hold_token_ok || return 1

    local session="${HAPI_SESSION_ID:-${HAPI_SESSION:-}}"
    local label="${HAPI_AGENT_LABEL:-}"
    local p
    local identity_ok=0

    if [[ -n "$session" ]]; then
        p="$HAPI_REMAT_OWNER_PREFIX"
        if [[ "${session,,}" == "${p,,}"* ]]; then
            identity_ok=1
        fi
    fi

    if [[ "$identity_ok" -eq 0 && -n "$label" ]]; then
        local L
        for L in $HAPI_REMAT_OWNER_LABELS; do
            if [[ "${label,,}" == "${L,,}" ]]; then
                identity_ok=1
                break
            fi
        done
    fi

    if [[ "$identity_ok" -eq 1 ]]; then
        return 0
    fi

    echo "ERROR: HAPI_REMAT_OWNER=1 + token ok, but session/label does not match remat escalate config" >&2
    echo "       session=${session:-none} label=${label:-none}" >&2
    echo "       expected prefix=$HAPI_REMAT_OWNER_PREFIX or labels: $HAPI_REMAT_OWNER_LABELS" >&2
    echo "       config: $HAPI_REMAT_ESCALATE_CONFIG" >&2
    return 1
}

# Refuse soup mutation if hold is active and caller is not owner.
# Exit 76 when blocked.
driver_remat_hold_require_clear_or_owner() {
    local what="${1:-soup mutation}"
    driver_remat_hold_active || return 0
    if driver_remat_hold_is_owner; then
        echo "Remat hold ACTIVE — proceeding as escalate owner ($what)" >&2
        return 0
    fi
    _driver_remat_hold_print_block "$what"
    exit 76
}

_driver_remat_hold_print_block() {
    local what="${1:-soup mutation}"
    _driver_remat_hold_load_config
    echo "ERROR: remat escalation HOLD active — refusing $what" >&2
    if [[ -f "$HAPI_REMAT_HOLD_FILE" ]] && command -v jq >/dev/null 2>&1; then
        echo "       reason: $(jq -r '.reason // "?"' "$HAPI_REMAT_HOLD_FILE")" >&2
        echo "       set_at: $(jq -r '.set_at // "?"' "$HAPI_REMAT_HOLD_FILE")" >&2
        echo "       set_by: $(jq -r '.set_by // "?"' "$HAPI_REMAT_HOLD_FILE")" >&2
        echo "       remat_wt: $(jq -r '.remat_wt // "?"' "$HAPI_REMAT_HOLD_FILE")" >&2
    fi
    echo "       Escalate to Meta remat owner (session prefix $HAPI_REMAT_OWNER_PREFIX)." >&2
    echo "       Inspect: hapi-remat-hold status" >&2
    echo "       Ping:    $HAPI_REMAT_PING_CMD" >&2
    echo "       Owner:   HAPI_REMAT_OWNER=1 + HAPI_REMAT_OWNER_TOKEN + matching label/session" >&2
    echo "       Do NOT retry remat / promote / build-web until hold is cleared." >&2
}

# Set hold (idempotent refresh of reason). Always succeeds if jq present.
driver_remat_hold_set() {
    local reason="${1:?reason required}"
    local remat_wt="${2:-}"
    local prev_tip="${3:-}"
    local wip_branch="${4:-}"
    local merge_ref="${5:-}"

    _driver_remat_hold_ensure_dir
    _driver_remat_hold_load_config
    command -v jq >/dev/null 2>&1 || {
        echo "WARN: jq missing — cannot write remat hold file" >&2
        return 1
    }

    local now set_by tmp
    now="$(_driver_remat_hold_now)"
    set_by="${HAPI_AGENT_LABEL:-operator}"
    tmp="$(mktemp -p "$HAPI_STATE_DIR" .remat-hold.XXXXXX.json)"
    jq -n \
        --arg schema "1" \
        --arg now "$now" \
        --arg reason "$reason" \
        --arg set_by "$set_by" \
        --arg remat_wt "$remat_wt" \
        --arg prev_tip "$prev_tip" \
        --arg wip_branch "$wip_branch" \
        --arg merge_ref "$merge_ref" \
        --arg owner_prefix "$HAPI_REMAT_OWNER_PREFIX" \
        --arg ping "$HAPI_REMAT_PING_CMD" \
        '{
          schema: ($schema | tonumber),
          active: true,
          set_at: $now,
          set_by: $set_by,
          reason: $reason,
          remat_wt: (if $remat_wt == "" then null else $remat_wt end),
          prev_tip: (if $prev_tip == "" then null else $prev_tip end),
          wip_branch: (if $wip_branch == "" then null else $wip_branch end),
          merge_ref: (if $merge_ref == "" then null else $merge_ref end),
          owner_session_prefix: $owner_prefix,
          ping_cmd: $ping
        }' >"$tmp"
    mv "$tmp" "$HAPI_REMAT_HOLD_FILE"

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  REMAT ESCALATION HOLD SET" >&2
    echo "  reason: $reason" >&2
    echo "  file:   $HAPI_REMAT_HOLD_FILE" >&2
    echo "  owner:  session prefix $HAPI_REMAT_OWNER_PREFIX (HAPI_REMAT_OWNER=1)" >&2
    echo "  Others: remat/build-web/promote BLOCKED until hold cleared." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    # Best-effort ping (never fail the remat path on ping errors).
    if [[ -n "$HAPI_REMAT_PING_CMD" ]]; then
        local msg
        msg="REMAT HOLD: $reason — you own escalation; others blocked. hapi-remat-hold status"
        # shellcheck disable=SC2086
        if command -v hapi-ping-peer >/dev/null 2>&1 || [[ "$HAPI_REMAT_PING_CMD" == hapi-ping-peer* ]]; then
            eval "$HAPI_REMAT_PING_CMD $(printf '%q' "$msg")" >/dev/null 2>&1 || true
        fi
    fi
    return 0
}

driver_remat_hold_clear() {
    local who="${1:-${HAPI_AGENT_LABEL:-operator}}"
    if ! driver_remat_hold_active; then
        echo "remat hold already clear ($HAPI_REMAT_HOLD_FILE)" >&2
        return 0
    fi
    if ! driver_remat_hold_is_owner; then
        _driver_remat_hold_print_block "clear hold"
        return 76
    fi
    _driver_remat_hold_ensure_dir
    local now tmp
    now="$(_driver_remat_hold_now)"
    tmp="$(mktemp -p "$HAPI_STATE_DIR" .remat-hold.XXXXXX.json)"
    if [[ -f "$HAPI_REMAT_HOLD_FILE" ]]; then
        jq --arg now "$now" --arg who "$who" \
            '.active = false | .cleared_at = $now | .cleared_by = $who' \
            "$HAPI_REMAT_HOLD_FILE" >"$tmp"
    else
        jq -n --arg now "$now" --arg who "$who" \
            '{schema:1, active:false, cleared_at:$now, cleared_by:$who}' >"$tmp"
    fi
    mv "$tmp" "$HAPI_REMAT_HOLD_FILE"
    echo "Remat escalation hold CLEARED by $who at $now" >&2
    return 0
}

# Clear hold only after a successful remat (owner path or no hold).
driver_remat_hold_clear_on_success() {
    driver_remat_hold_active || return 0
    if driver_remat_hold_is_owner; then
        driver_remat_hold_clear "remat-success"
        return 0
    fi
    # Should not happen (non-owner cannot remat under hold) — leave hold.
    echo "WARN: remat succeeded while hold active but caller is not owner — leaving hold" >&2
    return 0
}

driver_remat_hold_status_text() {
    if ! driver_remat_hold_active; then
        echo "remat-hold: idle (no escalation)"
    else
        _driver_remat_hold_load_config
        echo "remat-hold: ACTIVE"
        if command -v jq >/dev/null 2>&1; then
            jq -r '
              "  set_at:  \(.set_at // "?")",
              "  set_by:  \(.set_by // "?")",
              "  reason:  \(.reason // "?")",
              "  remat:   \(.remat_wt // "?")",
              "  prev:    \(.prev_tip // "?")",
              "  wip:     \(.wip_branch // "?")",
              "  conflict:\(.merge_ref // "?")",
              "  owner:   \(.owner_session_prefix // "?")",
              "  ping:    \(.ping_cmd // "?")"
            ' "$HAPI_REMAT_HOLD_FILE"
        fi
    fi
    driver_remat_lease_status_text
}

# ─────────────────────────────────────────────────────────────────────────────
# Single-writer LEASE (2026-07-31).
#
# The hold's owner gate passes on LABEL match alone, so two owner-labelled
# sessions (e.g. the meta-soup driver AND the PR watcher) both satisfy it and
# can race the same remat worktree — the corruption class the operator forbade.
# The lease pins remat to ONE live session: whoever holds it blocks every other
# caller (even owner-labelled ones) until they release it or the holder dies /
# goes stale. This is the mechanical single-writer guarantee.
#
# Keyed on HAPI_SESSION_ID (the HAPI session id, present in the agent's process
# cmdline so liveness is a pgrep). Stale-steal after HAPI_REMAT_LEASE_STALE_SEC
# of no heartbeat OR when the holder process is gone.
#
# Heartbeat bg uses HAPI_REMAT_LEASE_HEARTBEAT_SEC (default 120) — that is the
# `sleep 120` child you may see under a long rebuild; it is not a wait loop.
# ─────────────────────────────────────────────────────────────────────────────
HAPI_REMAT_LEASE_FILE="${HAPI_REMAT_LEASE_FILE:-$HAPI_STATE_DIR/remat-owner.lease}"
HAPI_REMAT_LEASE_STALE_SEC="${HAPI_REMAT_LEASE_STALE_SEC:-1800}"

# True when driver-status.json shows rebuild or switch running with a live pid.
# Operator TTY runs often lack HAPI_SESSION_ID in cmdline, so lease liveness is
# a weak proxy; this is the hard signal that soup mutation is in flight.
_driver_remat_driver_stack_busy() {
    local status_file="${HAPI_STATUS_FILE:-$HAPI_STATE_DIR/driver-status.json}"
    local op state pid
    [[ -f "$status_file" ]] || return 1
    command -v jq >/dev/null 2>&1 || return 1
    for op in rebuild switch; do
        state="$(jq -r ".${op}.state // \"idle\"" "$status_file" 2>/dev/null || echo idle)"
        pid="$(jq -r ".${op}.pid // \"null\"" "$status_file" 2>/dev/null || echo null)"
        if [[ "$state" == "running" && "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
            echo "$op pid=$pid"
            return 0
        fi
    done
    return 1
}

_driver_remat_lease_session() { echo "${HAPI_SESSION_ID:-${HAPI_SESSION:-}}"; }

# Live if a process carries the session id in its cmdline.
_driver_remat_lease_session_live() {
    local sid="$1"
    [[ -n "$sid" ]] || return 1
    pgrep -f "$sid" >/dev/null 2>&1
}

driver_remat_lease_holder() {
    [[ -f "$HAPI_REMAT_LEASE_FILE" ]] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    jq -r '.session // empty' "$HAPI_REMAT_LEASE_FILE" 2>/dev/null
}

driver_remat_lease_claim() {
    local reason="${1:-}"
    _driver_remat_hold_ensure_dir
    command -v jq >/dev/null 2>&1 || return 1
    local sid now tmp
    sid="$(_driver_remat_lease_session)"
    if [[ -z "$sid" ]]; then
        echo "WARN: no HAPI_SESSION_ID — cannot claim remat lease" >&2
        return 1
    fi
    now="$(_driver_remat_hold_now)"
    tmp="$(mktemp -p "$HAPI_STATE_DIR" .remat-lease.XXXXXX.json)"
    jq -n --arg sid "$sid" --arg lbl "${HAPI_AGENT_LABEL:-}" --arg reason "$reason" \
          --arg now "$now" \
        '{"schema":1, "session":$sid, "label":$lbl, "reason":$reason,
          "claimed_at":$now, "heartbeat_at":$now}' >"$tmp"
    mv "$tmp" "$HAPI_REMAT_LEASE_FILE"
}

driver_remat_lease_heartbeat() {
    [[ -f "$HAPI_REMAT_LEASE_FILE" ]] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    local sid now tmp
    sid="$(_driver_remat_lease_session)"
    [[ "$(driver_remat_lease_holder)" == "$sid" ]] || return 0
    now="$(_driver_remat_hold_now)"
    tmp="$(mktemp -p "$HAPI_STATE_DIR" .remat-lease.XXXXXX.json)"
    jq --arg now "$now" '.heartbeat_at=$now' "$HAPI_REMAT_LEASE_FILE" >"$tmp" && mv "$tmp" "$HAPI_REMAT_LEASE_FILE"
}

driver_remat_lease_release() {
    local sid; sid="$(_driver_remat_lease_session)"
    [[ -f "$HAPI_REMAT_LEASE_FILE" ]] || return 0
    if [[ "$(driver_remat_lease_holder)" == "$sid" || "${1:-}" == "--force" ]]; then
        rm -f "$HAPI_REMAT_LEASE_FILE"
        echo "remat single-writer lease released (${sid:-force})" >&2
    fi
}

# Background heartbeat during long soup mutations (rebuild, build-web).
# Without this, claimed_at==heartbeat_at forever and peers stale-steal after 30m.
HAPI_REMAT_LEASE_HB_PID=""

driver_remat_lease_heartbeat_bg_start() {
    local interval="${HAPI_REMAT_LEASE_HEARTBEAT_SEC:-120}"
    [[ -n "$(_driver_remat_lease_session)" ]] || return 0
    driver_remat_lease_heartbeat_bg_stop
    driver_remat_lease_heartbeat
    (
        while true; do
            sleep "$interval"
            driver_remat_lease_heartbeat || exit 0
        done
    ) &
    HAPI_REMAT_LEASE_HB_PID=$!
}

driver_remat_lease_heartbeat_bg_stop() {
    if [[ -n "${HAPI_REMAT_LEASE_HB_PID:-}" ]]; then
        kill "$HAPI_REMAT_LEASE_HB_PID" 2>/dev/null || true
        wait "$HAPI_REMAT_LEASE_HB_PID" 2>/dev/null || true
        HAPI_REMAT_LEASE_HB_PID=""
    fi
}

# Stop heartbeat loop and release lease if we are the holder.
driver_remat_lease_teardown() {
    driver_remat_lease_heartbeat_bg_stop
    driver_remat_lease_release
}

# Gate: refuse (exit 76) if a DIFFERENT live+fresh session holds the lease;
# otherwise claim/refresh it for the current session. Operator TTY steal:
# HAPI_OPERATOR_REMAT_LEASE_STEAL=1 (needs controlling tty).
driver_remat_lease_require() {
    local what="${1:-soup mutation}"
    command -v jq >/dev/null 2>&1 || return 0
    local mine holder hb hb_epoch now_epoch age live
    mine="$(_driver_remat_lease_session)"
    holder="$(driver_remat_lease_holder)"

    if [[ -z "$holder" || "$holder" == "$mine" ]]; then
        driver_remat_lease_claim "$what"
        return 0
    fi

    live=1; _driver_remat_lease_session_live "$holder" || live=0
    hb="$(jq -r '.heartbeat_at // empty' "$HAPI_REMAT_LEASE_FILE" 2>/dev/null)"
    hb_epoch="$(date -u -d "$hb" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date -u +%s)"
    age=$(( now_epoch - hb_epoch ))

    if [[ "$live" -eq 1 && "$hb_epoch" -gt 0 && "$age" -lt "$HAPI_REMAT_LEASE_STALE_SEC" ]]; then
        if [[ "${HAPI_OPERATOR_REMAT_LEASE_STEAL:-}" == "1" && -t 0 ]]; then
            echo "NOTE: operator TTY stealing remat lease from $holder" >&2
            driver_remat_lease_claim "$what (operator steal)"
            return 0
        fi
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "ERROR: remat single-writer LEASE held by another LIVE session — refusing $what" >&2
        echo "       holder:    $holder (label $(jq -r '.label // "?"' "$HAPI_REMAT_LEASE_FILE"))" >&2
        echo "       heartbeat: $hb (${age}s ago)" >&2
        echo "       you are:   ${mine:-<no HAPI_SESSION_ID>}" >&2
        echo "       Only ONE session may build soup at a time. Ping the holder; do not build concurrently." >&2
        echo "       Operator TTY steal (holder wedged): HAPI_OPERATOR_REMAT_LEASE_STEAL=1" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 76
    fi

    local stack_busy
    if stack_busy="$(_driver_remat_driver_stack_busy)"; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "ERROR: refusing stale-steal — driver stack busy ($stack_busy)" >&2
        echo "       lease holder: $holder (live=$live heartbeat ${age}s ago)" >&2
        echo "       Wait for hapi-driver-status to show idle, then retry." >&2
        echo "       Inspect: hapi-driver-status" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 76
    fi

    echo "NOTE: stealing stale remat lease from $holder (live=$live age=${age}s)" >&2
    driver_remat_lease_claim "$what (stole stale)"
    return 0
}

driver_remat_lease_status_text() {
    local holder
    holder="$(driver_remat_lease_holder)"
    if [[ -z "$holder" ]]; then
        echo "remat-lease: unheld (any owner may claim)"
        return 0
    fi
    local live=1; _driver_remat_lease_session_live "$holder" || live=0
    if command -v jq >/dev/null 2>&1; then
        echo "remat-lease: HELD by $holder (label $(jq -r '.label // "?"' "$HAPI_REMAT_LEASE_FILE"), live=$live, hb $(jq -r '.heartbeat_at // "?"' "$HAPI_REMAT_LEASE_FILE"))"
    else
        echo "remat-lease: HELD by $holder (live=$live)"
    fi
}
