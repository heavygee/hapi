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
    if ! driver_remat_touched_hub_cli_shared "$driver" "$prev_tip" "$new_tip"; then
        echo "post-remat: hub/cli/shared unchanged — skipping hapi-restart-hub (web-only: hard-reload dogfood)" >&2
        return 0
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
