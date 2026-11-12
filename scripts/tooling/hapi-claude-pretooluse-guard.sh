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
REMAT_HOLD_GUARD="${ROOT}/scripts/tooling/hapi-remat-hold-guard.sh"
MIRROR_HYGIENE_GUARD="${ROOT}/scripts/tooling/hapi-mirror-hygiene-guard.sh"
PRODUCT_GUARD="${ROOT}/scripts/tooling/hapi-product-code-guard.sh"
TOOLING_COMMIT_GUARD="${ROOT}/scripts/tooling/hapi-tooling-commit-guard.sh"

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

TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // .tool // empty' 2>/dev/null || true)"

# context-mode executes arbitrary code in a subprocess, so it is a second shell
# that every guard here was blind to: matchers only listed Bash, and the sub-
# guards only read .tool_input.command. A #987 peer ran a raw gradle build
# through ctx_execute, straight past the estate lock, before catching it.
#
# This is not merely "an agent could route around the guard" — the Bash guard
# *redirects* curl/wget to ctx_execute, so an agent following the instructions
# it is given lands outside the checks without ever intending to.
#
# Rather than reimplement the pattern lib for a second payload shape, normalise
# the executable text into the Bash shape the guards already understand. Every
# existing pattern, and every pattern added later, then covers both paths with
# no further work. Non-shell languages are matched as text too: a python
# payload calling subprocess with `systemctl restart hapi-hub` still contains
# that string, and these guards are textual by design.
case "$TOOL" in
    *ctx_execute|*ctx_execute_file|*ctx_batch_execute)
        _ctx_code="$(printf '%s' "$INPUT" | jq -r '
            [ .tool_input.code,
              .tool_input.command,
              ((.tool_input.commands // []) | map(.command // empty) | join("\n"))
            ]
            | map(select(. != null and . != ""))
            | join("\n")
        ' 2>/dev/null || true)"
        if [[ -n "$_ctx_code" ]]; then
            # The patterns are contiguous phrases ("systemctl restart ..."), so an
            # argv list — subprocess.run(["sudo", "systemctl", "restart", ...]) —
            # slips through on punctuation alone. Append a punctuation-stripped
            # copy so the phrase reforms and the same patterns catch both spellings.
            # Deliberately over-inclusive: a guard should err toward blocking, and
            # the operator TTY override already exists for the rare false positive.
            _ctx_flat="$(printf '%s' "$_ctx_code" | tr '",[](){}:;=+' ' ' | tr -s '[:space:]' ' ')"
            INPUT="$(jq -n --arg c "${_ctx_code}"$'\n'"${_ctx_flat}" \
                '{tool_name: "Bash", tool_input: {command: $c}}' 2>/dev/null || printf '%s' "$INPUT")"
            TOOL="Bash"
        fi
        ;;
esac

# Mirror hygiene: Bash (install/redirect) + Edit/Write (package.json / e2e on mirror).
_run_guard "$MIRROR_HYGIENE_GUARD"

case "$TOOL" in
    ""|Bash)
        _run_guard "$MUTATION_GUARD"
        _run_guard "$SYSTEMCTL_GUARD"
        _run_guard "$REMAT_HOLD_GUARD"
        # Mess-maker sync/rebuild gate (shell mode)
        if [[ -x "$TOOLING_COMMIT_GUARD" ]]; then
            out="$(printf '%s' "$INPUT" | "$TOOLING_COMMIT_GUARD" shell 2>/dev/null || true)"
            if printf '%s' "$out" | jq -e '.permission == "deny"' >/dev/null 2>&1; then
                msg="$(printf '%s' "$out" | jq -r '.agent_message // .user_message // "Blocked: commit your tooling dirt"')"
                _claude_deny "$msg"
            fi
        fi
        ;;
    Edit|Write|MultiEdit|NotebookEdit)
        _run_guard "$PRODUCT_GUARD"
        ;;
esac

exit 0
