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
if out="$(run)"; then rc=0; else rc=$?; fi
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
if out="$(run)"; then rc=0; else rc=$?; fi
[[ "$rc" == "0" ]] && ok || bad "unscoped present sentinel should pass (got $rc)"
man "layers:" "  - branch: driver/eps" "    sentinel: definitelyNotInTree" ""
if out="$(run)"; then bad "unscoped missing sentinel must exit non-zero"; else ok; fi

# 5. layers with no sentinel are counted, not failed — adoption must be gradual
man "layers:" "  - branch: driver/one" "  - branch: driver/two" "    sentinel: liveSymbol" "    sentinel_path: src/present.ts" ""
if out="$(run)"; then rc=0; else rc=$?; fi
[[ "$rc" == "0" ]] && ok || bad "undeclared layers must not fail the run (got $rc)"
printf '%s' "$out" | grep -q "1 of 2 layers undeclared" && ok || bad "undeclared coverage not reported: $out"

# 6. a sentinel with no preceding branch entry is a manifest error, not a pass
man "layers:" "    sentinel: orphaned" ""
if out="$(run)"; then bad "orphan sentinel must not silently pass"; else ok; fi

# ---------------------------------------------------------------------------
# --auto mode. Needs a real history: a layer, a tip that absorbed it, and a tip
# that absorbed it and then threw its code away.
#
# The comment filter is asserted BOTH ways. Two of the three false positives in
# the first 90-layer sweep were identifiers that only ever appeared in prose —
# a flag on a comment is a flag nobody can act on, and three of those in a row
# is how an operator learns to ignore the tool.
# ---------------------------------------------------------------------------
A="$WORK/auto"; mkdir -p "$A/src" "$A/config"
g() { git -C "$A" -c user.email=t@t -c user.name=t "$@"; }
g init -q
printf 'export const base = 1\n' > "$A/src/base.ts"
g add -A; g commit -qm base
BASE_SHA="$(g rev-parse HEAD)"

# layer-kept: adds a code symbol AND names a symbol only inside a comment.
g checkout -q -b layer-kept
cat > "$A/src/kept.ts" <<'EOF'
// historical note: ghostOnlyMentioned was the old name for this
export function realCodeSymbol() { return 1 }
EOF
g add -A; g commit -qm kept

# layer-lost: adds a code symbol that the tip will later delete outright.
g checkout -q "$BASE_SHA"; g checkout -q -b layer-lost
printf 'export function vanishedCodeSymbol() { return 2 }\n' > "$A/src/lost.ts"
g add -A; g commit -qm lost

# tip absorbs both, then a "conflict resolution" drops the comment from the
# kept layer (harmless) and deletes the lost layer's code (the real bug).
g checkout -q "$BASE_SHA"; g checkout -q -b tip
g merge -q --no-edit layer-kept layer-lost
printf 'export function realCodeSymbol() { return 1 }\n' > "$A/src/kept.ts"
g rm -q "$A/src/lost.ts"
g commit -qam "resolve"

amanv() { printf '%s\n' "$@" > "$A/m.yaml"; }
autorun() { bash "$S" --tree "$A" --manifest "$A/m.yaml" --auto 2>&1; }

# 7. a layer whose code survives passes, even though a commented-out name went
#    away with the comment. This is the regression guard for the prose filter.
amanv "layers:" "  - branch: layer-kept" ""
if out="$(autorun)"; then rc=0; else rc=$?; fi
[[ "$rc" == "0" ]] && ok || bad "--auto flagged a layer whose only missing name was in a comment (got $rc): $out"
printf '%s' "$out" | grep -q "ghostOnlyMentioned" && bad "comment-only identifier reached the report: $out" || ok

# 8. positive control — the same run must still go red on deleted CODE, or
#    test 7 proves nothing but that the tool stopped looking.
amanv "layers:" "  - branch: layer-lost" ""
if out="$(autorun)"; then bad "--auto must exit non-zero when a layer's code was deleted"; else ok; fi
printf '%s' "$out" | grep -q "LOST     layer-lost" && ok || bad "--auto did not name the layer that lost its code: $out"
printf '%s' "$out" | grep -q "vanishedCodeSymbol" && ok || bad "--auto did not name the missing identifier: $out"

# 9. a layer that was never absorbed (fat-tip SKIP) is not a finding: it is
#    legitimately absent, and reporting it would drown the real losses.
g checkout -q "$BASE_SHA"; g checkout -q -b layer-skipped
printf 'export function neverComposedSymbol() { return 3 }\n' > "$A/src/skipped.ts"
g add -A; g commit -qm skipped
g checkout -q tip
amanv "layers:" "  - branch: layer-skipped" ""
if out="$(autorun)"; then rc=0; else rc=$?; fi
[[ "$rc" == "0" ]] && ok || bad "--auto must not flag an unabsorbed layer (got $rc): $out"
printf '%s' "$out" | grep -q "0 layer(s) checked" && ok || bad "unabsorbed layer should not be counted as checked: $out"

# 10. coverage is complete — the lost symbol here sorts LAST, so any
#     `sort -u | head -N` prefix would miss it. This is the regression guard
#     for the sampling lottery: two sweeps over one tip once returned different
#     real losses because an unrelated edit moved the cut line.
g checkout -q "$BASE_SHA"; g checkout -q -b layer-wide
{ for i in $(seq -w 1 60); do printf 'export const aaaFiller%s = %s\n' "$i" "$i"; done
  printf 'export function zzzTailSymbol() { return 9 }\n'; } > "$A/src/wide.ts"
g add -A; g commit -qm wide
g checkout -q tip
g merge -q --no-edit layer-wide
# the tip keeps every filler and drops only the alphabetically-last symbol
grep -v zzzTailSymbol "$A/src/wide.ts" > "$A/src/wide.tmp" && mv "$A/src/wide.tmp" "$A/src/wide.ts"
g commit -qam "drop tail symbol"
amanv "layers:" "  - branch: layer-wide" ""
if out="$(autorun)"; then bad "--auto missed a lost symbol that sorts past any head -N cut"; else ok; fi
printf '%s' "$out" | grep -q "zzzTailSymbol" && ok || bad "--auto did not name the tail symbol — coverage is not complete: $out"

echo "hapi-sentinel-check: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
