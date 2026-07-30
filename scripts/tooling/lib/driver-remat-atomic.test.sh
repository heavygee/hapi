#!/usr/bin/env bash
# Unit tests for driver-remat-atomic.sh (operator-local).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=driver-remat-atomic.sh
source "$LIB/driver-remat-atomic.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_case() {
    local label="$1"
    shift
    if "$@"; then
        echo "OK: $label"
    else
        echo "FAIL: $label" >&2
        exit 1
    fi
}

# --- naming helpers ---
[[ "$(driver_remat_wip_branch driver/integration)" == "driver/integration-wip" ]] \
    || { echo "FAIL: wip branch name"; exit 1; }
echo "OK: wip branch name"

# --- miniature primary + driver worktree ---
PRIMARY="$TMP/primary"
git init -q -b main "$PRIMARY"
git -C "$PRIMARY" config user.email "test@hapi.local"
git -C "$PRIMARY" config user.name "hapi-test"
echo base >"$PRIMARY/README"
git -C "$PRIMARY" add README
git -C "$PRIMARY" commit -q -m "base"
git -C "$PRIMARY" branch upstream/main

# feature layer commit
git -C "$PRIMARY" checkout -q -b feat/one
echo one >"$PRIMARY/one.txt"
git -C "$PRIMARY" add one.txt
git -C "$PRIMARY" commit -q -m "feat one"
git -C "$PRIMARY" checkout -q main

# conflicting layer
git -C "$PRIMARY" checkout -q -b feat/conflict
echo conflict-a >"$PRIMARY/clash.txt"
git -C "$PRIMARY" add clash.txt
git -C "$PRIMARY" commit -q -m "conflict a"
git -C "$PRIMARY" checkout -q main

# driver worktree on integration @ main tip (prev soup)
DRIVER="$TMP/driver"
git -C "$PRIMARY" worktree add -q -b driver/integration "$DRIVER" main
echo soup >"$DRIVER/soup-marker.txt"
git -C "$DRIVER" add soup-marker.txt
git -C "$DRIVER" commit -q -m "prev soup tip"
PREV="$(git -C "$DRIVER" rev-parse HEAD)"

export HAPI_DRIVER_REMAT_WT="$TMP/worktrees/driver-remat"
mkdir -p "$TMP/worktrees"

# prepare remat WT from upstream/main (= main here)
REMAT="$(driver_remat_prepare "$PRIMARY" "driver/integration-wip" "main")"
[[ -d "$REMAT" ]] || { echo "FAIL: remat wt missing"; exit 1; }
# live tip unchanged
[[ "$(git -C "$DRIVER" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: prepare mutated driver"; exit 1; }
[[ ! -f "$DRIVER/one.txt" ]] || { echo "FAIL: prepare leaked layer into driver"; exit 1; }
echo "OK: prepare leaves live tip untouched"

# merge clean layer on remat only
git -C "$REMAT" merge --no-edit feat/one
[[ -f "$REMAT/one.txt" ]] || { echo "FAIL: layer not on remat"; exit 1; }
[[ ! -f "$DRIVER/one.txt" ]] || { echo "FAIL: layer leaked to driver before promote"; exit 1; }
echo "OK: merge stays on remat wt"

WIP_SHA="$(git -C "$REMAT" rev-parse HEAD)"
driver_remat_promote "$DRIVER" "driver/integration" "$WIP_SHA"
[[ "$(git -C "$DRIVER" rev-parse HEAD)" == "$WIP_SHA" ]] || { echo "FAIL: promote tip"; exit 1; }
[[ -f "$DRIVER/one.txt" ]] || { echo "FAIL: promote files"; exit 1; }
echo "OK: promote moves live tip"

# restore tip
driver_remat_restore_tip "$DRIVER" "driver/integration" "$PREV"
[[ "$(git -C "$DRIVER" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: restore tip sha"; exit 1; }
[[ ! -f "$DRIVER/one.txt" ]] || { echo "FAIL: restore left layer file"; exit 1; }
[[ -f "$DRIVER/soup-marker.txt" ]] || { echo "FAIL: restore lost prev marker"; exit 1; }
echo "OK: restore tip"

# conflict on remat must not touch driver
REMAT="$(driver_remat_prepare "$PRIMARY" "driver/integration-wip" "main")"
# seed clash on opposite side
git -C "$REMAT" checkout -q -B driver/integration-wip main
echo conflict-b >"$REMAT/clash.txt"
git -C "$REMAT" add clash.txt
git -C "$REMAT" commit -q -m "conflict b on wip"
set +e
git -C "$REMAT" merge --no-edit feat/conflict >/dev/null 2>&1
merge_rc=$?
set -e
[[ "$merge_rc" -ne 0 ]] || { echo "FAIL: expected conflict"; exit 1; }
[[ "$(git -C "$DRIVER" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: conflict mutated driver tip"; exit 1; }
echo "OK: conflict leaves live tip unchanged"

echo "driver-remat-atomic.test.sh: all cases OK"
