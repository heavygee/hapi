#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/scripts/tooling/hapi-claude-pretooluse-guard.sh"

expect_deny() {
    local label="$1"
    local payload="$2"
    local out
    out="$(printf '%s' "$payload" | "$GUARD")"
    if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null; then
        echo "OK deny: $label"
    else
        echo "FAIL expected deny: $label" >&2
        echo "$out" >&2
        exit 1
    fi
}

expect_allow() {
    local label="$1"
    local payload="$2"
    local out
    out="$(printf '%s' "$payload" | "$GUARD")"
    if [[ -n "$out" ]] && printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
        echo "FAIL expected allow: $label" >&2
        echo "$out" >&2
        exit 1
    fi
    echo "OK allow: $label"
}

CLAUDE_BASH='{"tool_name":"Bash","tool_input":{"command":"hapi-driver-rebuild --verify"}}'
CLAUDE_BUILD_WEB='{"tool_name":"Bash","tool_input":{"command":"hapi-driver-rebuild --build-web --verify"}}'

# Self-hosted tooling-tests share the operator HOME. Never leave HAPI_REMAT_HOLD_FILE
# unset (that falls through to ~/.hapi/remat-hold.json and flakes when a live remat
# HOLD is active). Incident: heavygee/hapi#216 CI run 37504390289.
HOLD_IDLE="$(mktemp)"
HOLD_ACTIVE="$(mktemp)"
trap 'rm -f "$HOLD_IDLE" "$HOLD_ACTIVE"' EXIT
printf '%s\n' '{"schema":1,"active":false}' >"$HOLD_IDLE"
printf '%s\n' '{"schema":1,"active":true,"reason":"claude-hold-test","owner_session_prefix":"8c6b5a7d"}' >"$HOLD_ACTIVE"
export HAPI_REMAT_HOLD_FILE="$HOLD_IDLE"
unset HAPI_REMAT_OWNER HAPI_REMAT_OWNER_TOKEN || true

expect_deny 'merge-only rebuild' "$CLAUDE_BASH"
expect_deny 'swap bypass build' '{"tool_name":"Bash","tool_input":{"command":"HAPI_BUILD_MAX_SWAP_USED_PCT=100 hapi-driver-build-web"}}'
expect_allow 'build-web rebuild' "$CLAUDE_BUILD_WEB"

# Remat hold: Claude Bash must deny rebuild while hold active (no owner token).
export HAPI_REMAT_HOLD_FILE="$HOLD_ACTIVE"
expect_deny 'remat hold blocks build-web' "$CLAUDE_BUILD_WEB"

# Back to idle isolation — still must not consult the host hold file.
export HAPI_REMAT_HOLD_FILE="$HOLD_IDLE"
expect_allow 'build-web rebuild under idle isolated hold' "$CLAUDE_BUILD_WEB"

echo "hapi-claude-pretooluse-guard.test.sh: all patterns OK"
