#!/usr/bin/env bash
# driver-remat-auto-restart.sh — post-remat patient hub+runner restart.
#
# Soup remat updates driver/ on disk only; live hub/runner processes keep old
# code until hapi-restart-hub runs. Lifecycle canon always listed that as a
# manual step — this lib makes it the default after a successful promote when
# hub/, cli/, or shared/ changed.
#
# Opt out: HAPI_DRIVER_NO_RESTART=1

# driver_remat_touched_hub_cli_shared <repo> <from_sha> <to_sha>
# Exit 0 when hub/cli/shared differ between the two commits.
driver_remat_touched_hub_cli_shared() {
    local repo="$1" from="$2" to="$3"
    [[ -n "$repo" && -n "$from" && -n "$to" ]] || return 1
    [[ "$from" != "$to" ]] || return 1
    git -C "$repo" diff --name-only "$from" "$to" -- hub/ cli/ shared/ 2>/dev/null | grep -q .
}

# driver_remat_hub_schema_version <repo> <ref>
# Prints hub SCHEMA_VERSION integer from hub/src/store/index.ts at ref (empty if absent).
driver_remat_hub_schema_version() {
    local repo="$1" ref="$2"
    git -C "$repo" show "$ref:hub/src/store/index.ts" 2>/dev/null \
        | sed -n 's/^const SCHEMA_VERSION: number = \([0-9][0-9]*\).*/\1/p' \
        | head -1
}

# driver_remat_hub_schema_bumped <repo> <from_sha> <to_sha>
# Exit 0 when hub schema version increased (migration requires hub restart).
driver_remat_hub_schema_bumped() {
    local repo="$1" from="$2" to="$3"
    local from_v to_v
    from_v="$(driver_remat_hub_schema_version "$repo" "$from")"
    to_v="$(driver_remat_hub_schema_version "$repo" "$to")"
    [[ -n "$from_v" && -n "$to_v" ]] || return 1
    [[ "$to_v" -gt "$from_v" ]]
}

# driver_remat_needs_hub_restart <repo> <from_sha> <to_sha>
# Exit 0 when post-remat patient restart is required (runtime code or schema migration).
driver_remat_needs_hub_restart() {
    local repo="$1" from="$2" to="$3"
    driver_remat_touched_hub_cli_shared "$repo" "$from" "$to" \
        || driver_remat_hub_schema_bumped "$repo" "$from" "$to"
}

# driver_remat_live_db_schema_lag <driver_repo>
# Exit 0 when live hub DB user_version trails driver tree SCHEMA_VERSION.
# Catches idempotent re-promotes (prev_tip==new_tip) after a prior skip left hub stale.
driver_remat_live_db_schema_lag() {
    local repo="$1"
    local db="${HAPI_HUB_DB:-/var/lib/hapi/hapi.db}"
    local driver_v db_v
    driver_v="$(driver_remat_hub_schema_version "$repo" HEAD)"
    [[ -n "$driver_v" ]] || return 1
    [[ -f "$db" ]] || return 1
    db_v="$(sqlite3 "$db" 'PRAGMA user_version;' 2>/dev/null)" || return 1
    [[ -n "$db_v" ]] || return 1
    [[ "$driver_v" -gt "$db_v" ]]
}

# driver_remat_resolve_restart_hub — print path to hapi-restart-hub.
driver_remat_resolve_restart_hub() {
    local primary="${HAPI_PRIMARY:-$HOME/coding/hapi}"
    if [[ -x "$HOME/.local/bin/hapi-restart-hub" ]]; then
        printf '%s\n' "$HOME/.local/bin/hapi-restart-hub"
        return 0
    fi
    if [[ -x "$primary/scripts/tooling/hapi-restart-hub.sh" ]]; then
        printf '%s\n' "$primary/scripts/tooling/hapi-restart-hub.sh"
        return 0
    fi
    return 1
}

# driver_remat_release_rebuild_lock — end rebuild status + release flock before switch.
driver_remat_release_rebuild_lock() {
    local driver="${1:?}"
    if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" == "1" ]]; then
        return 0
    fi
    # shellcheck source=driver-status.sh
    source "$(dirname "${BASH_SOURCE[0]}")/driver-status.sh"
    driver_status_end rebuild 0 \
        head_sha="$(git -C "$driver" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
        head_subject="$(git -C "$driver" log -1 --format=%s 2>/dev/null || echo unknown)"
    trap - EXIT
    eval "exec ${_HAPI_LOCK_FD_REBUILD}>&-"
}

# driver_remat_auto_restart_hub <driver> <prev_tip> <new_tip>
# Patient restart when hub/cli/shared changed. Propagates restart exit code.
driver_remat_auto_restart_hub() {
    local driver="$1" prev_tip="$2" new_tip="$3"
    if [[ "${HAPI_DRIVER_NO_RESTART:-}" == "1" ]]; then
        echo "post-remat: HAPI_DRIVER_NO_RESTART=1 — skipping hapi-restart-hub" >&2
        return 0
    fi
    if ! driver_remat_needs_hub_restart "$driver" "$prev_tip" "$new_tip" \
        && ! driver_remat_live_db_schema_lag "$driver"; then
        echo "post-remat: hub/cli/shared unchanged — skipping hapi-restart-hub (web-only: hard-reload dogfood)" >&2
        return 0
    fi
    if driver_remat_hub_schema_bumped "$driver" "$prev_tip" "$new_tip"; then
        local from_v to_v
        from_v="$(driver_remat_hub_schema_version "$driver" "$prev_tip")"
        to_v="$(driver_remat_hub_schema_version "$driver" "$new_tip")"
        echo "post-remat: hub SCHEMA_VERSION $from_v → $to_v — hub restart required (DB migration)" >&2
    elif driver_remat_live_db_schema_lag "$driver"; then
        local driver_v db_v
        driver_v="$(driver_remat_hub_schema_version "$driver" HEAD)"
        db_v="$(sqlite3 "${HAPI_HUB_DB:-/var/lib/hapi/hapi.db}" 'PRAGMA user_version;' 2>/dev/null)"
        echo "post-remat: live DB v$db_v behind driver SCHEMA_VERSION $driver_v — hub restart required" >&2
    fi
    local restart_bin
    if ! restart_bin="$(driver_remat_resolve_restart_hub)"; then
        echo "ERROR: post-remat needs hapi-restart-hub but none found on PATH" >&2
        return 1
    fi
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  POST-REMAT: hub/cli/shared changed — patient hapi-restart-hub"
    echo "  (drains WORKING sessions, then restarts hub + runner)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    driver_remat_release_rebuild_lock "$driver"
    exec "$restart_bin"
}
