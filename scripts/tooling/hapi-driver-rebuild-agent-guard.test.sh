#!/usr/bin/env bash
# Smoke-test agent guard on manifest-only hapi-driver-rebuild (non-Cursor agents).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/scripts/tooling/lib/driver-rebuild-agent-guard.sh"
LIB_DIR="$ROOT/scripts/tooling/lib"

# shellcheck source=lib/driver-rebuild-agent-guard.sh
source "$GUARD"

expect_refuse() {
    local label="$1"
    shift
    if driver_rebuild_agent_guard "$@" 2>/dev/null; then
        echo "FAIL expected refuse: $label" >&2
        exit 1
    fi
    echo "OK refuse: $label"
}

expect_allow() {
    local label="$1"
    shift
    if ! driver_rebuild_agent_guard "$@" 2>/dev/null; then
        echo "FAIL expected allow: $label" >&2
        exit 1
    fi
    echo "OK allow: $label"
}

export HAPI_AGENT_CONTEXT=1
unset HAPI_OPERATOR_DRIVER_REBUILD_MERGE_ONLY HAPI_OPERATOR_DRIVER_REBUILD_OVERRIDE

expect_refuse 'agent merge-only' 0
expect_allow 'agent with build-web' 1

unset HAPI_AGENT_CONTEXT
export HAPI_OPERATOR_DRIVER_REBUILD_MERGE_ONLY=1
expect_allow 'operator merge-only flag' 0

echo "hapi-driver-rebuild-agent-guard.test.sh: all patterns OK"
