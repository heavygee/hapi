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

expect_deny 'merge-only rebuild' "$CLAUDE_BASH"
expect_deny 'swap bypass build' '{"tool_name":"Bash","tool_input":{"command":"HAPI_BUILD_MAX_SWAP_USED_PCT=100 hapi-driver-build-web"}}'
expect_allow 'build-web rebuild' "$CLAUDE_BUILD_WEB"

# Remat hold: Claude Bash must deny rebuild while hold active (no owner token).
HOLD_TMP="$(mktemp)"
trap 'rm -f "$HOLD_TMP"' EXIT
echo '{"schema":1,"active":true,"reason":"claude-hold-test","owner_session_prefix":"8c6b5a7d"}' >"$HOLD_TMP"
export HAPI_REMAT_HOLD_FILE="$HOLD_TMP"
unset HAPI_REMAT_OWNER HAPI_REMAT_OWNER_TOKEN || true
expect_deny 'remat hold blocks build-web' "$CLAUDE_BUILD_WEB"
unset HAPI_REMAT_HOLD_FILE

echo "hapi-claude-pretooluse-guard.test.sh: all patterns OK"
