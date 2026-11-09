#!/usr/bin/env bash
# pre-push hook — the range it scans must match what the PR will actually show.
#
# The hook blocks fork-only paths (docs/operator/, docs/plans/) from leaving on
# a feat/ branch. Getting the RANGE wrong in the permissive direction leaks
# operator content upstream; getting it wrong in the strict direction is worse
# than it sounds, because the documented workaround — delete the file from the
# branch — creates a permanent modify/delete conflict against main (#238).
#
# Both directions are asserted.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/pre-push"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/r"; mkdir -p "$R/docs/operator" "$R/cli/src"
g() { git -C "$R" -c user.email=t@t -c user.name=t "$@"; }
g init -q
printf 'code\n' > "$R/cli/src/a.ts"
g add -A; g commit -qm base
g branch -q -M main
BASE="$(g rev-parse HEAD)"

# main gains an operator doc — the thing the tooling seat keeps editing.
printf 'handbook\n' > "$R/docs/operator/handbook.md"
g add -A; g commit -qm "operator handbook"
MAIN_WITH_DOC="$(g rev-parse HEAD)"
g update-ref refs/remotes/origin/main "$MAIN_WITH_DOC"

# feat branch cut BEFORE the doc existed, with one honest commit.
g checkout -q -b feat/x "$BASE"
printf 'feature\n' > "$R/cli/src/b.ts"
g add -A; g commit -qm feature
LAST_PUSHED="$(g rev-parse HEAD)"

run_hook() { # <local_sha> <remote_sha>
    (cd "$R" && printf 'refs/heads/feat/x %s refs/heads/feat/x %s\n' "$1" "$2" \
        | bash "$HOOK" origin 2>&1) || true
}

# 1. merging main in must NOT flag the operator doc the branch never authored.
#    Before the fix this flagged handbook.md, and the workaround was to delete
#    it — which is what produces the permanent modify/delete conflict.
g merge -q --no-edit "$MAIN_WITH_DOC"
MERGED="$(g rev-parse HEAD)"
out="$(run_hook "$MERGED" "$LAST_PUSHED")"
printf '%s' "$out" | grep -q "docs/operator/handbook.md" \
    && bad "merged-in operator doc flagged as the branch's own content: $out" || ok

# 2. positive control — a doc the branch GENUINELY adds must still be blocked,
#    or test 1 proves only that the hook stopped looking.
printf 'leak\n' > "$R/docs/operator/leak.md"
g add -A; g commit -qm "oops, operator content"
LEAKED="$(g rev-parse HEAD)"
out="$(run_hook "$LEAKED" "$LAST_PUSHED")"
printf '%s' "$out" | grep -q "docs/operator/leak.md" \
    && ok || bad "genuine operator leak was NOT blocked: $out"

# 3. ordinary incremental push with no merge keeps the narrow range and still
#    catches a leak in it.
g checkout -q -b feat/y "$BASE"
printf 'x\n' > "$R/cli/src/c.ts"; g add -A; g commit -qm c
Y1="$(g rev-parse HEAD)"
mkdir -p "$R/docs/operator"
printf 'leak2\n' > "$R/docs/operator/leak2.md"; g add -A; g commit -qm "leak2"
Y2="$(g rev-parse HEAD)"
out="$( (cd "$R" && printf 'refs/heads/feat/y %s refs/heads/feat/y %s\n' "$Y2" "$Y1" \
        | bash "$HOOK" origin 2>&1) || true)"
printf '%s' "$out" | grep -q "docs/operator/leak2.md" \
    && ok || bad "leak on a plain incremental push was not blocked: $out"

echo "pre-push: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
