#!/usr/bin/env bash
# Regression: active block must read ~/coding/hapi/active, not legacy hapi-active.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/tooling/lib/driver-status.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAKE_REPO="$TMP/hapi"
FAKE_DRIVER="$FAKE_REPO/driver"
FAKE_FEATURE="$TMP/feature-wt"
mkdir -p "$FAKE_DRIVER" "$FAKE_FEATURE"

ln -sfn "$FAKE_DRIVER" "$FAKE_REPO/active"

export HAPI_STATE_DIR="$TMP/state"
export HAPI_STATUS_FILE="$HAPI_STATE_DIR/driver-status.json"
export HAPI_ACTIVE_LINK="$FAKE_REPO/active"
export HAPI_DRIVER_PATH="$FAKE_DRIVER"

# shellcheck source=lib/driver-status.sh
source "$LIB"
driver_status_init

block="$(_driver_status_active_block)"
echo "$block" | jq -e --arg driver "$(readlink -f "$FAKE_DRIVER")" '
    .target == $driver and .is_driver == true and .symlink_mtime != null
' >/dev/null

driver_status_refresh_active
jq -e --arg driver "$(readlink -f "$FAKE_DRIVER")" '
    .active.target == $driver and .active.is_driver == true
' "$HAPI_STATUS_FILE" >/dev/null

# Legacy path must not be consulted when only hapi/active exists.
test ! -e "$TMP/hapi-active"

echo "hapi-driver-status-active.test.sh: OK"
