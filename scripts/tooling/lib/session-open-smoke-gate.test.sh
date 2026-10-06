#!/usr/bin/env bash
# Unit tests for session-open-smoke-gate.sh (no live hub required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=session-open-smoke-gate.sh
source "$(dirname "$0")/session-open-smoke-gate.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DRIVER="$TMP/driver"
mkdir -p "$DRIVER/web/dist" "$DRIVER/web/dist.prev"
echo live >"$DRIVER/web/dist/index.html"
echo prev >"$DRIVER/web/dist.prev/index.html"

driver_rollback_web_dist "$DRIVER"
[[ "$(cat "$DRIVER/web/dist/index.html")" == "prev" ]] || {
    echo "FAIL: rollback did not restore dist.prev" >&2
    exit 1
}
[[ ! -d "$DRIVER/web/dist.prev" ]] || {
    echo "FAIL: dist.prev should be consumed by rollback" >&2
    exit 1
}

# Skip path
export HAPI_SKIP_SESSION_OPEN_SMOKE=1
driver_session_open_smoke_gate "$DRIVER"
unset HAPI_SKIP_SESSION_OPEN_SMOKE

echo "session-open-smoke-gate.test.sh: all cases OK"
