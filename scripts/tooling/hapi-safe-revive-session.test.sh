#!/usr/bin/env bash
# Guard: hapi-safe-revive-session must keep its reaper-visible argv tokens.
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hapi-safe-revive-session.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

# 1. tokens present on the exec line
grep -q -- '-- --started-by runner --existing-session-id' "$S" && ok || bad "argv tokens missing from exec line"
# 2. they must trail the -e script, not precede it (bun would treat them as its own flags)
awk '/exec bun --cwd/{f=1} f&&/-- --started-by runner/{print NR; exit}' "$S" | grep -q . && ok || bad "tokens not after the -e script"
# 3. in-script startedBy must remain — it is what runCursor actually reads
grep -q "startedBy: 'runner'" "$S" && ok || bad "in-script startedBy removed; runCursor would lose ownership"
# 4. red-capable: a copy without the tokens must fail check 1
tmp=$(mktemp); sed 's/ -- --started-by runner --existing-session-id "\$HAPI_SESSION_ID"//' "$S" > "$tmp"
grep -q -- '-- --started-by runner' "$tmp" && bad "negative control did not strip tokens" || ok
rm -f "$tmp"
echo "revive argv guard: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
