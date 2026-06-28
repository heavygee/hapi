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
expect_allow 'build-web rebuild' "$CLAUDE_BUILD_WEB"

echo "hapi-claude-pretooluse-guard.test.sh: all patterns OK"
