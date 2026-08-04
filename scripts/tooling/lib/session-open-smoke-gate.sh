#!/usr/bin/env bash
# session-open-smoke-gate.sh — post-web-dist dogfood gate with auto-rollback.
#
# verify-soup-web-dist can be green while every /sessions/:id route error-boundaries
# (React #185 / Show Error). This wraps hapi-session-open-smoke and restores
# web/dist.prev (+ optional live tip) on failure so soup remat cannot leave
# dogfood broken.
#
# Skip: HAPI_SKIP_SESSION_OPEN_SMOKE=1 (operator emergency only).
# shellcheck shell=bash

driver_rollback_web_dist() {
    local driver="$1"
    local dist="$driver/web/dist"
    local prev="$driver/web/dist.prev"
    if [[ -d "$prev" ]]; then
        rm -rf "$dist"
        mv "$prev" "$dist"
        echo "Rolled back web/dist → previous bundle." >&2
        return 0
    fi
    echo "WARNING: no web/dist.prev to restore" >&2
    return 1
}

# driver_session_open_smoke_gate DRIVER
# Returns 0 on pass/skip. On fail: rolls back web/dist to dist.prev and returns 1.
# Tip restore is the caller's job (hapi-driver-rebuild remat_rollback_live_tip).
driver_session_open_smoke_gate() {
    local driver="$1"
    local primary="${HAPI_PRIMARY:-$HOME/coding/hapi}"
    local smoke="${HAPI_SESSION_OPEN_SMOKE:-$primary/scripts/tooling/hapi-session-open-smoke.mjs}"
    local bun="${BUN:-$HOME/.bun/bin/bun}"
    local hub="${HAPI_HUB_URL:-${HAPI_HOST:-http://127.0.0.1:3006}}"

    if [[ "${HAPI_SKIP_SESSION_OPEN_SMOKE:-}" == "1" ]]; then
        echo "session-open-smoke: SKIP (HAPI_SKIP_SESSION_OPEN_SMOKE=1)"
        return 0
    fi
    if [[ ! -f "$smoke" ]]; then
        echo "WARNING: session-open-smoke script missing ($smoke) — skipping gate" >&2
        return 0
    fi

    if ! curl -sf --max-time 5 "$hub/health" >/dev/null 2>&1; then
        echo "ERROR: hub health failed at $hub — cannot session-open-smoke; refusing to leave unverified dist" >&2
        driver_rollback_web_dist "$driver" || true
        return 1
    fi

    echo "Dogfood gate: hapi-session-open-smoke against $hub ..."
    local out rc=0
    out="$("$bun" run "$smoke" --hub "$hub" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    if [[ "$rc" -eq 0 ]]; then
        return 0
    fi

    echo "ERROR: session-open-smoke failed (exit $rc) — rolling back dogfood web/dist" >&2
    driver_rollback_web_dist "$driver" || true
    return 1
}
