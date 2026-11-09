#!/usr/bin/env bash
# Guard: patient drain must self-exempt EVERY agent flavour, not just Cursor.
# 2026-11-09: Cursor-only detection made the Claude tooling/meta bot hang at
# `effective WORKING=1` (itself) with `wait forever` — it cannot restart the
# hub at all via the supported path.
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hapi-restart-hub.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

# Extract the decision block and evaluate it in isolation, per flavour.
decide() { # env assignments... -> prints SELF_EXEMPT
    env -i bash -c '
        INCLUDE_SELF=${INCLUDE_SELF:-0}; SELF_EXEMPT=0
        '"$1"'
        if [[ "$INCLUDE_SELF" -ne 1 ]] && {
                [[ "${CURSOR_AGENT:-}" == "1" || "${CURSOR_INVOKED_AS:-}" == "agent" ]] \
                || [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_CODE_SESSION_ID:-}" ]] \
                || { [[ -n "${HAPI_SESSION_ID:-}" ]] && [[ ! -t 0 ]]; }
            }; then SELF_EXEMPT=1; fi
        echo "$SELF_EXEMPT"' < /dev/null
}

[[ "$(decide 'CURSOR_AGENT=1')"            == 1 ]] && ok || bad "cursor agent must self-exempt"
[[ "$(decide 'CLAUDECODE=1')"              == 1 ]] && ok || bad "claude agent must self-exempt (the 2026-11-09 hang)"
[[ "$(decide 'CLAUDE_CODE_SESSION_ID=x')"  == 1 ]] && ok || bad "claude session id must self-exempt"
[[ "$(decide 'HAPI_SESSION_ID=x')"         == 1 ]] && ok || bad "any wrapped HAPI session without a tty must self-exempt"
# Negative controls: a real operator shell and the explicit override must NOT exempt.
[[ "$(decide 'FOO=bar')"                   == 0 ]] && ok || bad "plain shell must NOT self-exempt"
[[ "$(decide 'CLAUDECODE=1; INCLUDE_SELF=1')" == 0 ]] && ok || bad "--patient-include-self must override the exemption"
# The script must actually contain the generalised test, not just pass in vitro.
grep -q 'CLAUDECODE' "$S" && ok || bad "script lost the claude branch"
grep -q 'HAPI_SESSION_ID' "$S" && ok || bad "script lost the flavour-agnostic branch"

# --- runtime guard: the drain message must not explode under `set -u` ---
# A --help probe is NOT a test of this: --help exits before patient_drain runs,
# so it stays green against the exact bug (verified — the first version of this
# test passed while the unguarded $CURSOR_AGENT was restored). Extract
# patient_drain and run it for real, with a stub health script reporting one
# WORKING session so the self-exempt branch is actually entered.
stub="$(mktemp)"; cat > "$stub" <<'STUB'
#!/usr/bin/env bash
echo '{"sessions":[{"status":"WORKING","sid8":"stub1234","project":"stub"}]}'
STUB
chmod +x "$stub"
harness="$(mktemp)"
{
    echo 'set -euo pipefail'
    echo 'INCLUDE_SELF=0; IMPATIENT=0'
    sed -n '/^SELF_EXEMPT=0/,/^PRIMARY=/p' "$S" | sed '$d'   # decision + WHY blocks
    sed -n '/^adjust_for_self()/,/^}/p' "$S"
    sed -n '/^patient_drain()/,/^}/p' "$S"
    echo 'PATIENT_TIMEOUT=1; PATIENT_INTERVAL=1'
    echo "HEALTH_SCRIPT='$stub'"
    echo 'patient_drain || true'
} > "$harness"
out="$(CLAUDECODE=1 HAPI_SESSION_ID=deadbeef-0000-0000-0000-000000000000 \
       bash "$harness" 2>&1 || true)"
rm -f "$stub" "$harness"
printf '%s' "$out" | grep -q "unbound variable" && bad "drain dies under set -u for a non-Cursor agent: $out" || ok
printf '%s' "$out" | grep -qi "wrapped agent session" && ok || bad "self-exempt message did not fire for claude: $out"

# --- the shared lib must not drift back to Cursor-only ---
# lib/patient-drain.sh has no consumer yet; it carried the identical bug, so
# adopting it would have reintroduced the Claude hang silently.
LIB="$(dirname "$S")/lib/patient-drain.sh"
if [[ -f "$LIB" ]]; then
    grep -q 'CLAUDECODE' "$LIB" && ok || bad "lib/patient-drain.sh is Cursor-only again"
    out="$(CLAUDECODE=1 bash -c "set -u; source '$LIB'; patient_drain_detect_self_exempt; echo \$PATIENT_SELF_EXEMPT" 2>&1 || true)"
    [[ "$out" == "1" ]] && ok || bad "lib does not self-exempt a claude caller: $out"
fi

# --- --cancel: stop a drain this seat started ---
# A patient drain waits forever by design, so a superseded one holds the switch
# flock and fires an unwanted restart whenever sessions next go quiet. kill/pkill
# are refused by the production-mutation guard (correctly — it cannot tell a
# restart wrapper from the hub), so the capability has to live in the wrapper.
grep -q -- '--cancel) CANCEL=1' "$S" && ok || bad "--cancel flag missing"
# it must never signal a process that is not this script
grep -q 'hapi-restart-hub\"\* \]\] || continue' "$S" && ok || bad "cancel does not narrow to this script's own pids"
# and must not escalate past SIGTERM
# behaviour, not prose: the script MENTIONS SIGKILL in a refusal message, so
# assert on an actual kill -9 / -KILL invocation instead.
# strip comments first: the script mentions SIGKILL and `kill -9` in prose, and
# a check that matches commentary is not a check. Third time tonight.
sed 's/#.*//' "$S" | grep -qE 'kill +-(9|KILL)' && bad "cancel escalates to SIGKILL — drains must exit via their EXIT trap" || ok
# no-op when nothing is running (safe to call blind)
out="$(bash "$S" --cancel 2>&1 || true)"
printf '%s' "$out" | grep -q "no other hapi-restart-hub drain running" && ok || bad "cancel is not a clean no-op: $out"
# and it must not print /proc race noise
printf '%s' "$out" | grep -q "No such file or directory" && bad "cancel leaks /proc pid-race noise: $out" || ok

# --- must refuse to stack drains (the 2026-11-09 stray-drain cause) ---
# Patient drains wait forever, so a second invocation queues rather than
# replaces, and both fire later. Simulate a live drain and assert the refusal.
fake="$(mktemp -d)/hapi-restart-hub"
printf '#!/usr/bin/env bash\nsleep 30\n' > "$fake"; chmod +x "$fake"
"$fake" & fakepid=$!
sleep 1
out="$(bash "$S" 2>&1 || true)"
kill "$fakepid" 2>/dev/null || true
printf '%s' "$out" | grep -q "already running" && ok || bad "did not refuse to stack a second drain: $(printf '%s' "$out" | head -3)"
printf '%s' "$out" | grep -q -- "--cancel" && ok || bad "refusal does not point at the recovery path"

echo "hapi-restart-hub self-exempt: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
