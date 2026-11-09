#!/usr/bin/env bash
# hapi-sentinel-check — every check must be able to go red.
#
# The whole point of this tool is catching a layer whose behaviour vanished
# while it stayed a provable ancestor. A sentinel checker that cannot report
# MISSING is exactly the kind of green-only instrument that let three real
# losses through in the first place.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$DIR/hapi-sentinel-check.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"; mkdir -p "$TREE/src" "$TREE/config"
git -C "$TREE" init -q 2>/dev/null || true
printf 'export function liveSymbol() { return 1 }\n' > "$TREE/src/present.ts"
printf 'nothing here\n' > "$TREE/src/other.ts"
git -C "$TREE" add -A 2>/dev/null; git -C "$TREE" -c user.email=t@t -c user.name=t commit -qm init 2>/dev/null || true

man() { printf '%s\n' "$@" > "$WORK/m.yaml"; }
run() { bash "$S" --tree "$TREE" --manifest "$WORK/m.yaml" 2>&1; }

# 1. present sentinel (path-scoped) -> pass, exit 0
man "layers:" "  - branch: driver/alpha" "    sentinel: liveSymbol" "    sentinel_path: src/present.ts" ""
out="$(run)"; rc=$?
[[ "$rc" == "0" ]] && ok || bad "present sentinel should exit 0 (got $rc)"
printf '%s' "$out" | grep -q "ok       driver/alpha" && ok || bad "present sentinel not reported ok: $out"

# 2. MISSING symbol -> red, exit 1, names the layer
man "layers:" "  - branch: driver/beta" "    sentinel: vanishedSymbol" "    sentinel_path: src/present.ts" ""
if out="$(run)"; then bad "missing sentinel must exit non-zero"; else ok; fi
printf '%s' "$out" | grep -q "MISSING  driver/beta" && ok || bad "missing sentinel did not name the layer: $out"
printf '%s' "$out" | grep -q "ancestor but its behaviour is gone" && ok || bad "missing sentinel lacks the explanatory line: $out"

# 3. sentinel_path that no longer exists -> red (file deleted by a merge)
man "layers:" "  - branch: driver/gamma" "    sentinel: anything" "    sentinel_path: src/deleted.ts" ""
if out="$(run)"; then bad "vanished sentinel_path must exit non-zero"; else ok; fi
printf '%s' "$out" | grep -q "does not exist in the composed tree" && ok || bad "vanished path not reported: $out"

# 4. unscoped sentinel searches the whole tree
man "layers:" "  - branch: driver/delta" "    sentinel: liveSymbol" ""
out="$(run)"; rc=$?
[[ "$rc" == "0" ]] && ok || bad "unscoped present sentinel should pass (got $rc)"
man "layers:" "  - branch: driver/eps" "    sentinel: definitelyNotInTree" ""
if out="$(run)"; then bad "unscoped missing sentinel must exit non-zero"; else ok; fi

# 5. layers with no sentinel are counted, not failed — adoption must be gradual
man "layers:" "  - branch: driver/one" "  - branch: driver/two" "    sentinel: liveSymbol" "    sentinel_path: src/present.ts" ""
out="$(run)"; rc=$?
[[ "$rc" == "0" ]] && ok || bad "undeclared layers must not fail the run (got $rc)"
printf '%s' "$out" | grep -q "1 of 2 layers undeclared" && ok || bad "undeclared coverage not reported: $out"

# 6. a sentinel with no preceding branch entry is a manifest error, not a pass
man "layers:" "    sentinel: orphaned" ""
if out="$(run)"; then bad "orphan sentinel must not silently pass"; else ok; fi

echo "hapi-sentinel-check: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
