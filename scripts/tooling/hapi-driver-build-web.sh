#!/usr/bin/env bash
# Rebuild web/dist only on the current driver/integration tree — no manifest merge.
#
# Use when driver source already matches manifest but web/dist is stale/wrong
# (e.g. merge restored web/src after vite ran, or dist swap regressed features).
#
# Usage:
#   hapi-driver-build-web              # atomic swap + verify
#   hapi-driver-build-web --skip-verify
set -euo pipefail

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/hapi-manifest-path.sh
source "$LIB_DIR/hapi-manifest-path.sh"
MANIFEST="$(hapi_manifest_path "${HAPI_PRIMARY:-$HOME/coding/hapi}")"
BUN="${BUN:-$HOME/.bun/bin/bun}"
SKIP_VERIFY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-verify) SKIP_VERIFY=1; shift ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/driver-status.sh
source "$LIB_DIR/driver-status.sh"
# shellcheck source=lib/driver-remat-hold.sh
source "$LIB_DIR/driver-remat-hold.sh"
# shellcheck source=lib/build-web-atomic.sh
source "$LIB_DIR/build-web-atomic.sh"

# Hold blocks build-web for non-owners (same tip thrash class as remat).
driver_remat_hold_require_clear_or_owner "hapi-driver-build-web"
# Single-writer lease: even owner-labelled sessions defer to the one live holder.
driver_remat_lease_require "hapi-driver-build-web"
driver_remat_lease_heartbeat_bg_start

if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" != "1" ]]; then
    driver_status_init
    driver_stack_wait_idle || exit $?
    driver_status_acquire rebuild
    driver_status_begin rebuild "build-web-only"
    _hapi_driver_build_web_on_exit() {
        local rc=$?
        driver_remat_lease_teardown
        driver_status_end rebuild "$rc" \
            head_sha="$(git -C "$DRIVER" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
            head_subject="web-only build"
        exit "$rc"
    }
    trap '_hapi_driver_build_web_on_exit' EXIT
else
    trap 'driver_remat_lease_teardown' EXIT
fi

if [[ ! -d "$DRIVER/web" ]]; then
    echo "ERROR: driver web dir missing: $DRIVER/web" >&2
    exit 1
fi

BINDINGS="$PRIMARY/scripts/tooling/verify-sessionlist-bindings.mjs"
if [[ -f "$BINDINGS" ]]; then
    echo "Checking SessionList helper bindings (fail-closed)..."
    "$BUN" run "$BINDINGS" "$DRIVER"
fi

COMPOSER_BINDINGS="$PRIMARY/scripts/tooling/verify-happycomposer-bindings.mjs"
if [[ -f "$COMPOSER_BINDINGS" ]]; then
    echo "Checking HappyComposer/SessionChat tip-forward bindings (fail-closed)..."
    "$BUN" run "$COMPOSER_BINDINGS" "$DRIVER"
fi

echo "Building web only (no manifest merge) on $(git -C "$DRIVER" log -1 --oneline)..."
build_web_atomic "$DRIVER"

VERIFY_SCRIPT="$PRIMARY/scripts/tooling/verify-soup-web-dist.mjs"
if [[ "$SKIP_VERIFY" -eq 0 ]] && [[ -f "$VERIFY_SCRIPT" ]]; then
    echo "Verifying web/dist matches driver web/src..."
    if ! "$BUN" run "$VERIFY_SCRIPT" "$DRIVER" "$MANIFEST" "$PRIMARY"; then
        echo "ERROR: web/dist verify failed — rolling back to dist.prev" >&2
        if [[ -d "$DRIVER/web/dist.prev" ]]; then
            rm -rf "$DRIVER/web/dist"
            mv "$DRIVER/web/dist.prev" "$DRIVER/web/dist"
            echo "Rolled back to previous dist bundle." >&2
        fi
        exit 1
    fi
fi

if [[ "$SKIP_VERIFY" -eq 0 ]]; then
    # shellcheck source=lib/session-open-smoke-gate.sh
    source "$LIB_DIR/session-open-smoke-gate.sh"
    if ! driver_session_open_smoke_gate "$DRIVER"; then
        exit 1
    fi
fi

echo "Done: web/dist refreshed at $(git -C "$DRIVER" rev-parse --short HEAD). Hard-reload :3006 browser."
