#!/usr/bin/env bash
# hapi-soup-excised-check — the mode split must go red in both directions.
#
# This gate had no tests. It then red-lit a compose over 37 layers that merely
# still had a dead file in their trees, which tip-forward would never replay
# (2026-11-09, caught by session 3c5af7c8 before it cost a remat). The fix
# makes the check mode-aware — and a mode-aware gate that quietly passes
# everything is strictly worse than the false positive it replaced, so every
# assertion here is paired with its opposite.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$DIR/hapi-soup-excised-check.mjs"
BUN="${BUN:-bun}"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

command -v "$BUN" >/dev/null 2>&1 || { echo "bun not on PATH — skipping"; exit 0; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/primary"; mkdir -p "$R/config" "$R/web/src/components"
g() { git -C "$R" -c user.email=t@t -c user.name=t "$@"; }
g init -q
printf 'base\n' > "$R/base.txt"
g add -A; g commit -qm base
g branch -q -M main
BASE="$(g rev-parse HEAD)"

# A layer that carries the dead file AND is merged into the tip. Tip-forward
# never replays it, so its copy cannot reach the composed tree.
g checkout -q -b layer-ancestor
printf 'export const Dead = 1\n' > "$R/web/src/components/DeadMenu.tsx"
g add -A; g commit -qm "carries dead file"

# A layer that carries it and is NOT in the tip: it really will be replayed.
g checkout -q "$BASE"; g checkout -q -b layer-pending
mkdir -p "$R/web/src/components"
printf 'export const Dead = 1\n' > "$R/web/src/components/DeadMenu.tsx"
g add -A; g commit -qm "pending, also carries it"

# The tip absorbs only the ancestor layer, then deletes the file.
g checkout -q "$BASE"; g checkout -q -b tip
g merge -q --no-edit layer-ancestor
g rm -q "$R/web/src/components/DeadMenu.tsx"
g commit -qm "excise the dead file"
TIP="$(g rev-parse HEAD)"

man() { { echo "layers:"; for b in "$@"; do echo "  - branch: $b"; done; } > "$R/config/driver-manifest.yaml"; }
reg() {
    if [[ "$1" == "empty" ]]; then printf 'excised: []\n' > "$R/config/soup-excised.yaml"
    else cat > "$R/config/soup-excised.yaml" <<'EOF'
excised:
  - path: web/src/components/DeadMenu.tsx
    reason: dead draft, replaced
    ref: test
EOF
    fi
}
run() { "$BUN" run "$S" --primary "$R" "$@" 2>&1; }

# 1. full-recipe stays exhaustive: BOTH carriers block, because a full recipe
#    merges every layer onto a fresh base and both trees reintroduce the file.
man layer-ancestor layer-pending; reg path
if out="$(run)"; then bad "full-recipe must fail when layers carry an excised path"; else ok; fi
printf '%s' "$out" | grep -q "layer-ancestor" && ok || bad "full-recipe omitted the ancestor carrier: $out"
printf '%s' "$out" | grep -q "layer-pending" && ok || bad "full-recipe omitted the pending carrier: $out"

# 2. tip-forward: the ancestor is inert, the pending layer still blocks.
if out="$(run --mode tip-forward --tip "$TIP")"; then
    bad "tip-forward must still fail while a NON-ancestor carrier exists"
else ok; fi
printf '%s' "$out" | grep -q "present but inert" && ok || bad "inert carriers not reported: $out"
printf '%s' "$out" | grep -A3 "WILL be replayed" | grep -q "layer-pending" \
    && ok || bad "tip-forward did not name the replayed carrier: $out"
printf '%s' "$out" | grep -A3 "WILL be replayed" | grep -q "layer-ancestor" \
    && bad "tip-forward wrongly blocked on an ancestor carrier: $out" || ok

# 3. tip-forward with ONLY the ancestor carrier passes — the false positive
#    that started this — but must still SAY the file is present.
man layer-ancestor; reg path
if out="$(run --mode tip-forward --tip "$TIP")"; then ok; else bad "tip-forward must pass when every carrier is an ancestor: $out"; fi
printf '%s' "$out" | grep -q "present but inert" && ok || bad "inert carrier went unreported — silence is the old bug: $out"
printf '%s' "$out" | grep -q "full recipe" && ok || bad "no warning that a full recipe reintroduces it: $out"

# 4. ...and the SAME manifest under full-recipe must still fail. If this
#    passes, the fix has disabled the gate rather than scoped it.
if out="$(run)"; then bad "full-recipe went quiet on an ancestor carrier — gate disabled, not scoped"; else ok; fi

# 5. tip-forward WITHOUT a tip cannot prove anything is inert, so it must fall
#    back to exhaustive rather than pass by default.
if out="$(run --mode tip-forward)"; then bad "tip-forward with no --tip must fail closed"; else ok; fi

# 6. a clean registry passes in both modes
man layer-ancestor layer-pending; reg empty
run >/dev/null 2>&1 && ok || bad "empty registry should pass full-recipe"
run --mode tip-forward --tip "$TIP" >/dev/null 2>&1 && ok || bad "empty registry should pass tip-forward"

echo "hapi-soup-excised-check: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
