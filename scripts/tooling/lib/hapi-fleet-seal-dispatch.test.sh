#!/usr/bin/env bash
# Run: bash scripts/tooling/lib/hapi-fleet-seal-dispatch.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=hapi-fleet-seal-dispatch.sh
source "$ROOT/scripts/tooling/lib/hapi-fleet-seal-dispatch.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/targets.yaml" <<'YAML'
schema: 1
targets:
  - id: demo-estate
    type: estate-hub
    enabled: true
  - id: demo-layer-a
    type: standalone-layer-a
    enabled: true
  - id: demo-cattle
    type: cattle-vm-swap
    enabled: true
    host: demo-host
    status: pending
  - id: disabled-one
    type: estate-hub
    enabled: false
YAML

export HAPI_FLEET_TARGETS="$TMP/targets.yaml"
list="$(hapi_fleet_targets_list)"
echo "$list" | grep -q $'^demo-estate\testate-hub' || fail "estate row missing"
echo "$list" | grep -q $'^demo-layer-a\tstandalone-layer-a' || fail "layer-a row missing"
echo "$list" | grep -q $'^demo-cattle\tcattle-vm-swap\tdemo-host\tpending' || fail "cattle row missing"
echo "$list" | grep -q 'disabled-one' && fail "disabled target should be omitted"
pass "registry list parses generic target types"

hapi_fleet_seal_dispatch hapi-soup-v2099.01.01-deadbeef --dry-run \
    || fail "dry-run dispatch should succeed"
pass "dispatch dry-run walks all enabled types"

echo "All hapi-fleet-seal-dispatch tests passed."
