#!/usr/bin/env bash
# Smoke-test mirror utensil hygiene guard (operator-local).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/scripts/tooling/hapi-mirror-hygiene-guard.sh"
export HAPI_ROOT_OVERRIDE="$ROOT"

expect_deny() {
    local payload="$1"
    local label="$2"
    local out
    out=$(printf '%s' "$payload" | "$GUARD")
    if printf '%s' "$out" | jq -e '.permission == "deny"' >/dev/null; then
        echo "OK deny: $label"
    else
        echo "FAIL expected deny: $label" >&2
        echo "$out" >&2
        exit 1
    fi
}

expect_allow() {
    local payload="$1"
    local label="$2"
    local out
    out=$(printf '%s' "$payload" | "$GUARD")
    if printf '%s' "$out" | jq -e '.permission == "allow"' >/dev/null; then
        echo "OK allow: $label"
    else
        echo "FAIL expected allow: $label" >&2
        echo "$out" >&2
        exit 1
    fi
}

# #1084 class: install on mirror
expect_deny "$(jq -cn --arg c "cd $ROOT && bun install" '{command:$c}')" 'cd mirror && bun install'
expect_deny "$(jq -cn --arg c 'bun install' --arg w "$ROOT" '{command:$c, working_directory:$w}')" 'bun install cwd=mirror'
expect_deny "$(jq -cn --arg c 'npm install' '{command:$c}')" 'npm install no cwd (fail closed)'
expect_deny "$(jq -cn --arg c 'bun add @modelcontextprotocol/sdk' --arg w "$ROOT" '{command:$c, working_directory:$w}')" 'bun add on mirror'

# Worktree installs OK
expect_allow "$(jq -cn --arg c "cd $ROOT/worktrees/hub-runner-version-skew && bun install" '{command:$c}')" 'cd worktree && bun install'
expect_allow "$(jq -cn --arg c 'bun install' --arg w "$ROOT/worktrees/hub-runner-version-skew" '{command:$c, working_directory:$w}')" 'bun install cwd=worktree'

# Write path blocks
expect_deny "$(jq -cn --arg p "$ROOT/package.json" '{tool_name:"Write", input:{path:$p}}')" 'Write package.json on mirror'
expect_deny "$(jq -cn --arg p "$ROOT/bun.lock" '{tool_name:"Write", input:{path:$p}}')" 'Write bun.lock on mirror'
expect_deny "$(jq -cn --arg p "$ROOT/e2e/peer/1084-runner-version-skew-banner.spec.ts" '{tool_name:"Write", input:{path:$p}}')" 'Write e2e on mirror'

# Worktree writes OK
expect_allow "$(jq -cn --arg p "$ROOT/worktrees/hub-runner-version-skew/e2e/peer/1084.spec.ts" '{tool_name:"Write", input:{path:$p}}')" 'Write e2e in worktree'
expect_allow "$(jq -cn --arg p "$ROOT/config/driver-manifest.yaml" '{tool_name:"Write", input:{path:$p}}')" 'manifest write OK'
expect_allow "$(jq -cn --arg p "$ROOT/docs/tooling/driver-soup.md" '{tool_name:"Write", input:{path:$p}}')" 'docs write OK'

# Shell redirect into e2e on mirror
expect_deny "$(jq -cn --arg c "cat > $ROOT/e2e/peer/x.spec.ts <<'EOF'
test
EOF" '{command:$c}')" 'redirect into mirror e2e'

echo "hapi-mirror-hygiene-guard.test.sh: all patterns OK"
