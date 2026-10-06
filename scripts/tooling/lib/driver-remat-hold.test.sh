#!/usr/bin/env bash
# Unit tests for driver-remat-hold.sh
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=driver-remat-hold.sh
source "$LIB/driver-remat-hold.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HAPI_STATE_DIR="$TMP/state"
export HAPI_REMAT_HOLD_FILE="$TMP/state/remat-hold.json"
export HAPI_REMAT_ESCALATE_CONFIG="$TMP/escalate.yaml"
export HAPI_REMAT_OWNER_TOKEN_FILE="$TMP/remat-owner.token"
mkdir -p "$HAPI_STATE_DIR"

cat >"$HAPI_REMAT_ESCALATE_CONFIG" <<'EOF'
owner_session_prefix: "aabbccdd"
owner_labels:
  - meta-soup
  - meta-soup-stabilize
ping_cmd: "true"
EOF

# Fresh: not active
driver_remat_hold_active && { echo "FAIL: hold should be idle"; exit 1; }
echo "OK: idle by default"

# Init token
driver_remat_hold_init_owner_token
[[ -f "$HAPI_REMAT_OWNER_TOKEN_FILE" ]] || { echo "FAIL: token file missing"; exit 1; }
TOKEN="$(tr -d '[:space:]' <"$HAPI_REMAT_OWNER_TOKEN_FILE")"
[[ -n "$TOKEN" ]] || { echo "FAIL: empty token"; exit 1; }
echo "OK: init-owner token"

# Set hold
driver_remat_hold_set "test conflict" "/tmp/remat" "deadbeef" "driver/integration-wip" "feat/x"
driver_remat_hold_active || { echo "FAIL: hold not active after set"; exit 1; }
echo "OK: set hold"

# Non-owner blocked
unset HAPI_REMAT_OWNER HAPI_REMAT_OWNER_TOKEN HAPI_SESSION_ID HAPI_AGENT_LABEL || true
export HAPI_AGENT_LABEL=peer-feature
set +e
( driver_remat_hold_require_clear_or_owner "test" )
rc=$?
set -e
[[ "$rc" -eq 76 ]] || { echo "FAIL: expected exit 76 got $rc"; exit 1; }
echo "OK: non-owner blocked (76)"

# Label alone (no token) rejected
export HAPI_REMAT_OWNER=1
export HAPI_AGENT_LABEL=meta-soup
unset HAPI_REMAT_OWNER_TOKEN || true
set +e
driver_remat_hold_is_owner
rc=$?
set -e
[[ "$rc" -ne 0 ]] || { echo "FAIL: label without token should fail"; exit 1; }
echo "OK: label without token rejected"

# Wrong token rejected
export HAPI_REMAT_OWNER_TOKEN=wrong-token
set +e
driver_remat_hold_is_owner
rc=$?
set -e
[[ "$rc" -ne 0 ]] || { echo "FAIL: wrong token should fail"; exit 1; }
echo "OK: wrong token rejected"

# Matching label + token
export HAPI_REMAT_OWNER_TOKEN="$TOKEN"
export HAPI_AGENT_LABEL=meta-soup
driver_remat_hold_is_owner || { echo "FAIL: meta-soup+token should be owner"; exit 1; }
echo "OK: label+token owner"

# Matching session + token
unset HAPI_AGENT_LABEL
export HAPI_SESSION_ID=aabbccdd-1234-5678-9abc-def012345678
driver_remat_hold_is_owner || { echo "FAIL: session+token should be owner"; exit 1; }
echo "OK: session+token owner"

# Clear as owner
driver_remat_hold_clear "test" || { echo "FAIL: clear"; exit 1; }
driver_remat_hold_active && { echo "FAIL: still active after clear"; exit 1; }
echo "OK: clear"

echo "driver-remat-hold.test.sh: all cases OK"
