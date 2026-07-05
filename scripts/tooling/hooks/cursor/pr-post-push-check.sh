#!/usr/bin/env bash
# Cursor postToolUse (Shell): after git push to a branch with an open PR, wait 5 minutes
# then inject unresolved thread count + latest comments into agent context.

set -euo pipefail

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // .command // ""')

if [[ ! "$cmd" =~ (^|[;&|[:space:]])git[[:space:]]+push[[:space:]]+origin ]]; then
    echo '{}'
    exit 0
fi

branch=$(echo "$cmd" | sed -E 's/.*origin[[:space:]]+//' | awk '{print $1}')
if [ -z "$branch" ]; then
    echo '{}'
    exit 0
fi

ctx=$("$HOME/.local/bin/pr-post-push-check-core.sh" "$branch" || true)
if [ -z "$ctx" ]; then
    echo '{}'
    exit 0
fi

jq -n --arg ctx "$ctx" '{"additional_context": $ctx}'
