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

echo "hapi-restart-hub self-exempt: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
