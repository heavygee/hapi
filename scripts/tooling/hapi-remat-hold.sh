#!/usr/bin/env bash
# hapi-remat-hold — inspect / set / clear soup remat escalation hold.
#
# When rematerialize fails, hapi-driver-rebuild auto-sets this hold. Until the
# designated Meta remat owner clears it, other agents cannot remat, promote,
# or build-web.
#
# Usage:
#   hapi-remat-hold status
#   hapi-remat-hold set "reason" [remat_wt] [prev_tip] [wip_branch] [merge_ref]
#   hapi-remat-hold clear          # owner only (token + identity)
#   hapi-remat-hold check          # exit 0 clear, 76 held (for scripts)
#   hapi-remat-hold init-owner [--force]  # create/rotate ~/.config/hapi/remat-owner.token
#
# Owner proof:
#   HAPI_REMAT_OWNER=1
#   + HAPI_REMAT_OWNER_TOKEN=$(cat ~/.config/hapi/remat-owner.token)
#   + session/label matches config/remat-escalate.yaml
# Operator TTY: HAPI_OPERATOR_REMAT_HOLD_CLEAR=1 (controlling tty required)
set -euo pipefail

LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/driver-remat-hold.sh
source "$LIB_DIR/driver-remat-hold.sh"

cmd="${1:-status}"
shift || true

case "$cmd" in
    status|-s)
        driver_remat_hold_status_text
        if driver_remat_hold_active; then
            exit 76
        fi
        exit 0
        ;;
    check|-q|--quiet)
        if driver_remat_hold_active; then
            exit 76
        fi
        exit 0
        ;;
    set)
        reason="${1:?usage: hapi-remat-hold set \"reason\" [remat_wt] [prev_tip] [wip] [merge_ref]}"
        # The reason is POSITIONAL. Passing `--reason "text"` silently stored
        # "--reason" as the reason and shifted the real text into remat_wt —
        # which made the hold banner read `reason: --reason` at the exact
        # moment it mattered (2026-11-10, an in-flight absorb whose whole point
        # was telling other agents not to reset the merge). A hold that cannot
        # say why it exists is barely a hold.
        case "$reason" in
            --*)
                echo "hapi-remat-hold: reason is positional, not a flag — you passed '$reason'." >&2
                echo "  Use: hapi-remat-hold set \"why this hold exists\" [remat_wt] [prev_tip] [wip] [merge_ref]" >&2
                exit 2
                ;;
        esac
        shift || true
        driver_remat_hold_set "$reason" "${1:-}" "${2:-}" "${3:-}" "${4:-}"
        exit 0
        ;;
    clear)
        # clear returns 76 if not owner
        set +e
        driver_remat_hold_clear
        rc=$?
        set -e
        exit "$rc"
        ;;
    init-owner)
        driver_remat_hold_init_owner_token "${1:-}"
        exit 0
        ;;
    -h|--help|help)
        sed -n '2,22p' "$0"
        exit 0
        ;;
    *)
        echo "Unknown command: $cmd (status|check|set|clear|init-owner)" >&2
        exit 2
        ;;
esac
