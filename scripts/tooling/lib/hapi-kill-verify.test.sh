#!/usr/bin/env bash
# hapi-kill-verify.test.sh — red-driven: a death check only ever seen passing
# is not evidence. Every assertion here uses a real spawned process, not a
# mock — the thing we're proving is "does this correctly refuse to proceed
# when a real process outlives the bound", not "does a stub return the right
# boolean".
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hapi-kill-verify.sh
source "$DIR/hapi-kill-verify.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

cleanup_pids=()
trap 'for p in "${cleanup_pids[@]:-}"; do kill -KILL "$p" 2>/dev/null || true; done' EXIT

# --- 1. GREEN: a real process that dies on its own within the bound is confirmed dead ---
sleep 0.1 &
pid=$!
if hapi_kill_verify_wait_dead "$pid" 3 0.05; then
    ok
else
    bad "green: real short-lived pid $pid should have been confirmed dead within 3s"
fi
[[ -d "/proc/$pid" ]] && bad "green: pid $pid still present after confirmed-dead return" || ok

# --- 2. RED: a real process that outlives the bound must be reported as a survivor, not silently passed ---
sleep 30 &
pid=$!
cleanup_pids+=("$pid")
if hapi_kill_verify_wait_dead "$pid" 0.3 0.05; then
    bad "red: real long-lived pid $pid was reported dead — it is NOT, this is exactly the unverified-kill class"
else
    ok
fi
# The function's job is only to report truthfully; confirm the process actually is still there
# (otherwise the red fixture itself would be invalid, not the code under test).
[[ -d "/proc/$pid" ]] || bad "red fixture invalid: pid $pid exited on its own before the check ran"
[[ -d "/proc/$pid" ]] && ok

# --- 3. Edge: an already-reaped pid is confirmed dead immediately, no full timeout spent ---
sleep 0.01 &
pid=$!
wait "$pid" 2>/dev/null || true
start=$(date +%s.%N)
if hapi_kill_verify_wait_dead "$pid" 5 0.1; then
    ok
else
    bad "edge: already-dead pid $pid should confirm dead immediately"
fi
elapsed=$(awk -v s="$start" -v e="$(date +%s.%N)" 'BEGIN{print e-s}')
if awk -v e="$elapsed" 'BEGIN{exit !(e < 2)}'; then
    ok
else
    bad "edge: already-dead pid took ${elapsed}s — should return fast, not burn the full timeout"
fi

# --- 4. Proves the remote (proxmox) path serializes the SAME function, not a hand-maintained twin ---
serialized="$(bash -c "source '$DIR/hapi-kill-verify.sh' && declare -f hapi_kill_verify_wait_dead")"
if [[ -n "$serialized" ]] && bash -c "$serialized"'; sleep 0.1 & p=$!; hapi_kill_verify_wait_dead "$p" 3 0.05' ; then
    ok
else
    bad "serialized function (the form shipped over SSH to proxmox) did not behave identically"
fi

echo
echo "pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
