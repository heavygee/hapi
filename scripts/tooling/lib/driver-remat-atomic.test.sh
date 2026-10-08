#!/usr/bin/env bash
# Unit tests for driver-remat-atomic.sh (operator-local).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=driver-remat-atomic.sh
source "$LIB/driver-remat-atomic.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Self-hosted tooling-tests share the operator HOME. Isolate remat hold state so a
# live ~/.hapi/remat-hold.json (or any host HOLD) cannot fail promote/prepare.
# Incident: heavygee/hapi#216 CI run 37504390289 — host HOLD active mid-remat.
export HAPI_STATE_DIR="$TMP/hapi-state"
mkdir -p "$HAPI_STATE_DIR"
export HAPI_REMAT_HOLD_FILE="$HAPI_STATE_DIR/remat-hold.json"
export HAPI_REMAT_OWNER_TOKEN_FILE="$TMP/remat-owner.token"
export HAPI_REMAT_ESCALATE_CONFIG="$TMP/escalate.yaml"
printf '%s\n' '{"schema":1,"active":false}' >"$HAPI_REMAT_HOLD_FILE"
cat >"$HAPI_REMAT_ESCALATE_CONFIG" <<'EOF'
owner_session_prefix: "aaaaaaaa"
owner_labels:
  - meta-soup
ping_cmd: ""
EOF
unset HAPI_REMAT_OWNER HAPI_REMAT_OWNER_TOKEN HAPI_SESSION_ID HAPI_AGENT_LABEL \
    HAPI_OPERATOR_REMAT_HOLD_CLEAR || true

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

# tip-forward prepare starts at PREV tip (keeps soup-marker)
REMAT="$(HAPI_REMAT_MODE=tip-forward driver_remat_prepare "$PRIMARY" "driver/integration-wip" "$PREV")"
[[ "$(git -C "$REMAT" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: tip-forward prepare not at PREV"; exit 1; }
[[ -f "$REMAT/soup-marker.txt" ]] || { echo "FAIL: tip-forward lost soup marker"; exit 1; }
[[ "$(git -C "$DRIVER" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: tip-forward prepare mutated driver"; exit 1; }
echo "OK: tip-forward prepare starts at PREV tip"

# invalid mode
set +e
HAPI_REMAT_MODE=bogus driver_remat_mode >/dev/null 2>&1
mode_rc=$?
set -e
[[ "$mode_rc" -ne 0 ]] || { echo "FAIL: bogus mode should fail"; exit 1; }
echo "OK: driver_remat_mode rejects bogus"

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

# Resume keeps committed WIP progress (does not wipe back to start_ref)
git -C "$REMAT" merge --abort >/dev/null 2>&1 || true
git -C "$REMAT" checkout -q -B driver/integration-wip "$PREV"
echo resume-me >"$REMAT/resume.txt"
git -C "$REMAT" add resume.txt
git -C "$REMAT" commit -q -m "conflict resolution progress"
RESUME_SHA="$(git -C "$REMAT" rev-parse HEAD)"
REMAT="$(HAPI_REMAT_RESUME=1 HAPI_REMAT_MODE=tip-forward driver_remat_prepare "$PRIMARY" "driver/integration-wip" "$PREV")"
[[ "$(git -C "$REMAT" rev-parse HEAD)" == "$RESUME_SHA" ]] || { echo "FAIL: resume wiped WIP"; exit 1; }
[[ -f "$REMAT/resume.txt" ]] || { echo "FAIL: resume lost resolution file"; exit 1; }
echo "OK: HAPI_REMAT_RESUME=1 keeps WIP tip"

# Force reset still works
REMAT="$(HAPI_REMAT_RESUME=0 HAPI_REMAT_MODE=tip-forward driver_remat_prepare "$PRIMARY" "driver/integration-wip" "$PREV")"
[[ "$(git -C "$REMAT" rev-parse HEAD)" == "$PREV" ]] || { echo "FAIL: RESUME=0 should reset to PREV"; exit 1; }
[[ ! -f "$REMAT/resume.txt" ]] || { echo "FAIL: RESUME=0 left resolution file"; exit 1; }
echo "OK: HAPI_REMAT_RESUME=0 hard-resets WIP"

# Isolated hold file still gates promote (prove the check is wired, not merely skipped).
# driver_remat_hold_require_clear_or_owner uses `exit 76` (not return) — subshell required.
printf '%s\n' '{"schema":1,"active":true,"reason":"atomic-isolation-probe","owner_session_prefix":"aaaaaaaa"}' \
    >"$HAPI_REMAT_HOLD_FILE"
set +e
( driver_remat_promote "$DRIVER" "driver/integration" "$PREV" ) >"$TMP/atomic-hold-promote.out" 2>&1
hold_promote_rc=$?
set -e
[[ "$hold_promote_rc" -eq 76 ]] || {
    echo "FAIL: active isolated hold should refuse promote (rc=$hold_promote_rc)" >&2
    cat "$TMP/atomic-hold-promote.out" >&2 || true
    exit 1
}
printf '%s\n' '{"schema":1,"active":false}' >"$HAPI_REMAT_HOLD_FILE"
echo "OK: isolated active hold refuses promote (exit 76)"

echo "driver-remat-atomic.test.sh: all cases OK"
