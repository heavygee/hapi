#!/usr/bin/env bash
# hapi-pr-merge-verdict — must be able to say BOTH "clean" and "conflicts".
#
# A merge checker that only ever reports one answer is worse than none: it
# either sends every session off to rebase a clean branch, or tells everyone
# a real conflict is "just GitHub lag". Both directions are asserted here,
# offline, against a local fixture.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$DIR/hapi-pr-merge-verdict.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; mkdir -p "$R"
g() { git -C "$R" -c user.email=t@t -c user.name=t "$@"; }
g init -q
printf 'shared\n' > "$R/shared.txt"
printf 'handbook v1\n' > "$R/operator.md"
g add -A; g commit -qm base
BASE_SHA="$(g rev-parse HEAD)"

# main advances: edits the handbook (this is the real-world trigger — the
# tooling seat keeps editing docs/operator/ on main).
g checkout -q -b mainline
printf 'handbook v2\n' > "$R/operator.md"
g add -A; g commit -qm "edit handbook"

# branch A: touches only its own file -> merges clean.
g checkout -q "$BASE_SHA"; g checkout -q -b clean-branch
printf 'feature\n' > "$R/feature.txt"
g add -A; g commit -qm feature
CLEAN_SHA="$(g rev-parse HEAD)"

# branch B: deletes the handbook (the fork-path-policy strip) -> modify/delete.
g checkout -q "$BASE_SHA"; g checkout -q -b strip-branch
g rm -q "$R/operator.md"
g commit -qm "strip operator docs for the path hook"
STRIP_SHA="$(g rev-parse HEAD)"

run() { (cd "$R" && bash "$S" --base mainline --no-fetch --head "$1" 999 2>&1); }

# 1. a branch that merges cleanly must exit 0 and say so
if out="$(run "$CLEAN_SHA")"; then ok; else bad "clean branch must exit 0: $out"; fi
printf '%s' "$out" | grep -q "MERGES CLEAN" && ok || bad "clean verdict not reported: $out"

# 2. positive control — a real conflict must exit 1, or test 1 proves only that
#    the tool stopped looking
if out="$(run "$STRIP_SHA")"; then bad "conflicting branch must exit non-zero"; else ok; fi
printf '%s' "$out" | grep -q "CONFLICTS" && ok || bad "conflict verdict not reported: $out"

# 3. naming the path is the difference between actionable and "dirty"
printf '%s' "$out" | grep -q "operator.md" && ok || bad "conflicting path not named: $out"

# 4. modify/delete must be diagnosed, not just counted — this is the shape that
#    recurs on every main-side edit until the branch rebases
printf '%s' "$out" | grep -q "modify/delete" && ok || bad "modify/delete not diagnosed: $out"
printf '%s' "$out" | grep -qi "rebase onto" && ok || bad "no remedy offered for modify/delete: $out"

# 5. a plain content conflict must NOT be mislabelled modify/delete
g checkout -q "$BASE_SHA"; g checkout -q -b edit-branch
printf 'handbook rival\n' > "$R/operator.md"
g add -A; g commit -qm "rival edit"
EDIT_SHA="$(g rev-parse HEAD)"
if out="$(run "$EDIT_SHA")"; then bad "rival edit must conflict"; else ok; fi
printf '%s' "$out" | grep -q "modify/delete" && bad "content conflict mislabelled modify/delete: $out" || ok

# 6. a bad PR number is a usage error (exit 2), never an answer — callers must
#    not read a tool failure as "clean" or "conflicts"
if (cd "$R" && bash "$S" --base mainline --no-fetch notanumber >/dev/null 2>&1); then
    bad "non-numeric pr must not succeed"
else
    rc=$?; [[ "$rc" == "2" ]] && ok || bad "non-numeric pr should exit 2, got $rc"
fi

# 7. an unresolvable base is a tool failure, not a conflict finding
if (cd "$R" && bash "$S" --base no/such/ref --no-fetch --head "$CLEAN_SHA" 999 >/dev/null 2>&1); then
    bad "missing base must not succeed"
else
    rc=$?; [[ "$rc" == "2" ]] && ok || bad "missing base should exit 2 (not 1), got $rc"
fi

echo "hapi-pr-merge-verdict: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
