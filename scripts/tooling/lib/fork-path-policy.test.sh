#!/usr/bin/env bash
# fork-path-policy — pin the predicates, and pin the summary text to them.
#
# These predicates decide whether a push leaks fork-private content. They had
# no tests, and on 2026-11-10 a cold review on #238 raised a Blocker straight
# from fork_policy_github_safe_paths()'s wording — it collapsed the upstream
# and origin rules into one line and so claimed docs/plans/ was blocked on an
# origin feat/ push. It is not. The reviewer's predicted failure had already
# succeeded in reality.
#
# A summary that over-states the rule is not harmless: it invents Blockers and
# teaches people to "fix" branches that were already compliant.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/fork-path-policy.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

allow(){ "$@" >/dev/null 2>&1; }

# --- upstream (strict): all three fork-private trees are blocked -------------
for p in docs/operator/AGENTS.md docs/plans/x.md .cursor/rules/operator-fork.mdc; do
    allow fork_pre_push_upstream_ok feat/x "$p" \
        && bad "upstream must block $p" || ok
done
allow fork_pre_push_upstream_ok feat/x cli/src/index.ts && ok || bad "upstream must allow product code"

# --- origin, feat/fix/soup: operator trees blocked, docs/plans ALLOWED -------
# This asymmetry is the whole reason this file has tests.
for b in feat/x fix/y soup/z; do
    allow fork_pre_push_origin_ok "$b" docs/operator/AGENTS.md \
        && bad "origin $b must block docs/operator" || ok
    allow fork_pre_push_origin_ok "$b" .cursor/rules/operator-fork.mdc \
        && bad "origin $b must block .cursor/rules/operator*" || ok
    allow fork_pre_push_origin_ok "$b" docs/plans/x.md \
        && ok || bad "origin $b must ALLOW docs/plans — this is the drift that invented a Blocker"
done

# --- origin, canon branches: everything allowed ------------------------------
for b in main driver/x garden/y tooling/z docs/w; do
    allow fork_pre_push_origin_ok "$b" docs/operator/AGENTS.md \
        && ok || bad "origin $b must allow docs/operator (canon branch)"
    allow fork_pre_push_origin_ok "$b" docs/plans/x.md \
        && ok || bad "origin $b must allow docs/plans (canon branch)"
done

# --- the summary text must not contradict the predicates ---------------------
summary="$(fork_policy_github_safe_paths)"
printf '%s' "$summary" | grep -qi "docs/plans/ IS allowed" \
    && ok || bad "summary no longer states the origin docs/plans asymmetry"
printf '%s' "$summary" | grep -qi "not named \"origin\"" \
    && ok || bad "summary must warn that unknown remotes are treated as upstream"
# The exact line that caused the false Blocker must not come back.
printf '%s' "$summary" | grep -q "Upstream + origin feat/fix/soup branches:" \
    && bad "the conflated upstream+origin line is back — it over-states the origin rule" || ok

echo "fork-path-policy: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
