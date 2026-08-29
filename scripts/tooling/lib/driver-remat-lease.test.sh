#!/usr/bin/env bash
# Unit tests for remat single-writer lease teardown (no live HAPI sessions).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_STATE="$(mktemp -d)"
trap 'rm -rf "$TMP_STATE"' EXIT

export HAPI_STATE_DIR="$TMP_STATE"
export HAPI_SESSION_ID="test-lease-session-$(date +%s)"
export HAPI_AGENT_LABEL="test"

# shellcheck source=driver-remat-hold.sh
source "$ROOT/scripts/tooling/lib/driver-remat-hold.sh"

driver_remat_lease_claim "test claim"
[[ -f "$HAPI_REMAT_LEASE_FILE" ]] || { echo "FAIL: lease file missing after claim" >&2; exit 1; }

hb1="$(jq -r '.heartbeat_at' "$HAPI_REMAT_LEASE_FILE")"
sleep 1
driver_remat_lease_heartbeat
hb2="$(jq -r '.heartbeat_at' "$HAPI_REMAT_LEASE_FILE")"
[[ "$hb2" != "$hb1" ]] || { echo "FAIL: heartbeat did not advance ($hb1 -> $hb2)" >&2; exit 1; }

driver_remat_lease_heartbeat_bg_start
sleep 1
driver_remat_lease_teardown

if [[ -f "$HAPI_REMAT_LEASE_FILE" ]]; then
    echo "FAIL: lease file still present after teardown" >&2
    exit 1
fi

echo "driver-remat-lease.test.sh: all passed"
