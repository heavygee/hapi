#!/usr/bin/env bash
# Unit tests for driver-remat-layer-gate.sh
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=driver-remat-layer-gate.sh
source "$LIB/driver-remat-layer-gate.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PRIMARY="$TMP/primary"
git init -q -b main "$PRIMARY"
git -C "$PRIMARY" config user.email "test@hapi.local"
git -C "$PRIMARY" config user.name "hapi-test"
echo base >"$PRIMARY/README"
git -C "$PRIMARY" add README
git -C "$PRIMARY" commit -q -m "base"
TIP="$(git -C "$PRIMARY" rev-parse HEAD)"

# thin layer: 1 commit, 1 file
git -C "$PRIMARY" checkout -q -b feat/thin
echo thin >"$PRIMARY/thin.txt"
git -C "$PRIMARY" add thin.txt
git -C "$PRIMARY" commit -q -m "thin"
git -C "$PRIMARY" checkout -q main

# fat layer: many commits
git -C "$PRIMARY" checkout -q -b feat/fat
for i in $(seq 1 25); do
    echo "f$i" >"$PRIMARY/fat-$i.txt"
    git -C "$PRIMARY" add "fat-$i.txt"
    git -C "$PRIMARY" commit -q -m "fat $i"
done
git -C "$PRIMARY" checkout -q main

driver_remat_layer_gate "$PRIMARY" "$TIP" feat/thin \
    || { echo "FAIL: thin layer should pass"; exit 1; }
echo "OK: thin layer passes gate"

set +e
driver_remat_layer_gate "$PRIMARY" "$TIP" feat/fat >/dev/null 2>&1
fat_rc=$?
set -e
[[ "$fat_rc" -ne 0 ]] || { echo "FAIL: fat layer should refuse"; exit 1; }
echo "OK: fat layer refused"

set +e
HAPI_REMAT_ABSORB_FAT=1 driver_remat_layer_gate "$PRIMARY" "$TIP" feat/fat >/dev/null 2>&1
absorb_rc=$?
set -e
[[ "$absorb_rc" -eq 0 ]] || { echo "FAIL: ABSORB_FAT should allow"; exit 1; }
echo "OK: HAPI_REMAT_ABSORB_FAT override"

echo "driver-remat-layer-gate.test.sh: all cases OK"
