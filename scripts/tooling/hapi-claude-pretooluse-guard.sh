#!/usr/bin/env bash
# Claude Code PreToolUse adapter for HAPI operator guards (project-scoped only).
#
# Wired from:
#   - .claude/settings.json in the hapi repo (manual `claude` in this project)
#   - per-session --settings from HAPI CLI generateHookSettingsFile (runner sessions)
#
# Reuses Cursor guard scripts + shared pattern lib; translates deny JSON to Claude
# hookSpecificOutput. Does NOT belong in ~/.claude/settings.json (global).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MUTATION_GUARD="${ROOT}/scripts/tooling/hapi-production-mutation-guard.sh"
SYSTEMCTL_GUARD="${ROOT}/scripts/tooling/hapi-systemctl-guard.sh"

INPUT="$(cat)"

_claude_deny() {
    local reason="$1"
    jq -n \
        --arg reason "$reason" \
        '{
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: $reason
            }
        }'
    exit 0
}

_run_guard() {
    local guard_script="$1"
    if [[ ! -x "$guard_script" ]]; then
        return 1
    fi
    local out
    out="$(printf '%s' "$INPUT" | "$guard_script" 2>/dev/null || true)"
    if printf '%s' "$out" | jq -e '.permission == "deny"' >/dev/null 2>&1; then
        local msg
        msg="$(printf '%s' "$out" | jq -r '.agent_message // .user_message // "Blocked by HAPI guard"')"
        _claude_deny "$msg"
    fi
}

# Bash-only: soup / production mutation + systemctl (matches Cursor Shell hooks).
TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // .tool // empty' 2>/dev/null || true)"
if [[ -n "$TOOL" && "$TOOL" != "Bash" ]]; then
    exit 0
fi

_run_guard "$MUTATION_GUARD"
_run_guard "$SYSTEMCTL_GUARD"

exit 0
