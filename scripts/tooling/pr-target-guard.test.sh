#!/usr/bin/env bash
# Smoke-test pr-target-guard (fork-only diff must not target tiann/hapi).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/pr-target-guard.sh
source "$ROOT/scripts/tooling/lib/pr-target-guard.sh"

expect_block() {
    local label="$1"
    shift
    if reason="$(pr_target_upstream_block_reason "$@")"; then
        echo "OK block: $label"
    else
        echo "FAIL expected block: $label" >&2
        exit 1
    fi
}

expect_allow() {
    local label="$1"
    shift
    if reason="$(pr_target_upstream_block_reason "$@")"; then
        echo "FAIL expected allow: $label" >&2
        echo "$reason" >&2
        exit 1
    else
        echo "OK allow: $label"
    fi
}

# Simulate #971: tooling branch with scripts/tooling in diff vs upstream/main
PR_TARGET_GUARD_ROOT="$ROOT"
if git -C "$ROOT" merge-base --is-ancestor upstream/main HEAD 2>/dev/null; then
    expect_block 'fork tooling diff on default repo' tiann/hapi
fi

expect_allow 'explicit fork repo' heavygee/hapi

echo "pr-target-guard.test.sh: OK"
