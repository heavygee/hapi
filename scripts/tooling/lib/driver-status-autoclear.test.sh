#!/usr/bin/env bash
# driver_stack_autoclear_stale must not heal `switch` while a drain is alive.
#
# 2026-11-09: three hapi-restart-hub drains accumulated because a half-killed
# drain (pkill of the recorded wrapper) left live waiters. Dead recorded pid +
# free flock read as "stale", autoclear healed the lie, and each later caller
# acquired cleanly and queued another drain behind the live one.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$DIR/driver-status.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; [[ -n "${fake:-}" ]] && kill "$fake" 2>/dev/null || true' EXIT
export HAPI_STATUS_FILE="$WORK/status.json"
export HAPI_LOCK_DIR="$WORK/locks"; mkdir -p "$HAPI_LOCK_DIR"

# status: switch running, recorded pid long dead, lock file free
printf '{"switch":{"state":"running","pid":999999}}\n' > "$HAPI_STATUS_FILE"
: > "$HAPI_LOCK_DIR/switch.lock"

# 1. with NO drain alive it still heals (the kill -9 leftover case must work)
out="$(bash -c "source '$LIB'; driver_stack_autoclear_stale switch" 2>&1 || true)"
printf '%s' "$out" | grep -q "healed" && ok || bad "must still heal a genuine dead-pid leftover: $out"

# 2. with a live drain present it must REFUSE, and name the recovery path
printf '{"switch":{"state":"running","pid":999999}}\n' > "$HAPI_STATUS_FILE"
: > "$HAPI_LOCK_DIR/switch.lock"
fakedir="$(mktemp -d)"; fake_bin="$fakedir/hapi-restart-hub"
printf '#!/usr/bin/env bash\nsleep 25\n' > "$fake_bin"; chmod +x "$fake_bin"
"$fake_bin" & fake=$!
sleep 1
out2="$(bash -c "source '$LIB'; driver_stack_autoclear_stale switch" 2>&1 || true)"
kill "$fake" 2>/dev/null || true; fake=""
printf '%s' "$out2" | grep -q "not clearing" && ok || bad "healed while a live drain existed: $out2"
printf '%s' "$out2" | grep -q -- "--cancel" && ok || bad "refusal does not name the recovery path: $out2"
printf '%s' "$out2" | grep -q "healed" && bad "claimed healed while refusing: $out2" || ok

echo "driver-status autoclear: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
