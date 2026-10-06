#!/usr/bin/env bash
# Claude Code PostToolUse hook: after git push to a branch with an open PR, wait 5 minutes
# then check for unresolved review threads and new comments.

set -euo pipefail

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

if [[ ! "$cmd" =~ ^git[[:space:]]+push[[:space:]]+origin ]]; then
    exit 0
fi

branch=$(echo "$cmd" | sed -E 's/.*origin[[:space:]]+//' | awk '{print $1}')
if [ -z "$branch" ]; then
    exit 0
fi

ctx=$("$HOME/.local/bin/pr-post-push-check-core.sh" "$branch" || true)
if [ -z "$ctx" ]; then
    exit 0
fi

jq -n \
    --arg ctx "$ctx" \
    '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":$ctx}}'
