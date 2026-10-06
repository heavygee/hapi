#!/usr/bin/env bash
# hapi-pr-merge-gate — deterministic pre-merge gate.
#
# WHY THIS EXISTS (2026-09-13 incident):
#   @tiann commented on tiann/hapi#1842 "one reproducible UI regression to fix
#   before merging". It was a PLAIN COMMENT, not a "Request changes" review, so
#   GitHub reported mergeStateStatus=CLEAN and reviewDecision="". An agent
#   verified checks-on-SHA + mergeable + diff scope, called it green, and merged
#   13 hours later over the maintainer's explicit objection.
#
#   CI green never meant reviewed. reviewDecision="" means UNREVIEWED, not
#   approved. This gate makes that impossible to get wrong again by machine.
#
# Exit 0 = every condition satisfied. Any non-zero = DO NOT MERGE.
# Called automatically by gh-wrapper.sh on `gh pr merge`; also runnable alone.
#
# Usage:  hapi-pr-merge-gate.sh <pr-number> [--repo owner/name]

set -euo pipefail

REAL_GH="${HAPI_REAL_GH:-/usr/bin/gh}"
PR="${1:-}"
shift || true
REPO=""
while [ $# -gt 0 ]; do
    case "$1" in
        --repo) REPO="${2:-}"; shift 2 ;;
        *) shift ;;
    esac
done

[ -n "$PR" ] || { echo "usage: hapi-pr-merge-gate.sh <pr-number> [--repo owner/name]" >&2; exit 64; }

if [ -z "$REPO" ]; then
    REPO="$("$REAL_GH" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
[ -n "$REPO" ] || { echo "GATE FAIL: cannot resolve repo" >&2; exit 65; }

FAIL=0
note() { printf '  %-6s %s\n' "$1" "$2" >&2; }
fail() { FAIL=1; note "BLOCK" "$1"; }
pass() { note "ok" "$1"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  PRE-MERGE GATE — $REPO#$PR" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

META="$("$REAL_GH" pr view "$PR" --repo "$REPO" \
    --json isDraft,state,mergeable,reviewDecision,headRefOid,author,files,latestReviews 2>/dev/null || true)"
[ -n "$META" ] || { echo "GATE FAIL: cannot read PR $REPO#$PR" >&2; exit 65; }

STATE=$(jq -r '.state' <<<"$META")
DRAFT=$(jq -r '.isDraft' <<<"$META")
MERGEABLE=$(jq -r '.mergeable' <<<"$META")
REVIEW=$(jq -r '.reviewDecision // ""' <<<"$META")
HEAD=$(jq -r '.headRefOid' <<<"$META")
AUTHOR=$(jq -r '.author.login' <<<"$META")

# 1. open, not draft, mergeable
[ "$STATE" = "OPEN" ] && pass "state OPEN" || fail "state is $STATE"
[ "$DRAFT" = "false" ] && pass "not a draft" || fail "PR is a draft"
[ "$MERGEABLE" = "MERGEABLE" ] && pass "mergeable" || fail "mergeable=$MERGEABLE (UNKNOWN means GitHub is still computing — re-run)"

# 2. checks green ON THE HEAD SHA (not the PR-level summary, which can lag a push)
CR="$("$REAL_GH" api "repos/$REPO/commits/$HEAD/check-runs" --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"' 2>/dev/null || true)"
if [ -z "$CR" ]; then
    fail "no check-runs found for head $HEAD"
else
    BAD=$(awk -F'\t' '$2!="completed" || ($3!="success" && $3!="neutral" && $3!="skipped")' <<<"$CR" | head -5)
    [ -z "$BAD" ] && pass "all checks green on head ${HEAD:0:9}" \
        || fail "checks not green on head ${HEAD:0:9}: $(tr '\n' ' ' <<<"$BAD")"
fi

# 3. review decision must not be a rejection
[ "$REVIEW" = "CHANGES_REQUESTED" ] && fail "reviewDecision=CHANGES_REQUESTED" || pass "no CHANGES_REQUESTED"

# 4. UNRESOLVED REVIEW THREADS — the thing status APIs hide
THREADS="$("$REAL_GH" api graphql -f query='
  query($owner:String!,$name:String!,$pr:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$pr){
        reviewThreads(first:100){ nodes { isResolved isOutdated comments(first:1){ nodes { author{login} body } } } }
      }}}' \
  -F owner="${REPO%%/*}" -F name="${REPO##*/}" -F pr="$PR" \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false and .isOutdated==false)] | length' 2>/dev/null || echo "ERR")"
if [ "$THREADS" = "ERR" ]; then
    fail "could not read review threads (treating as blocking — empty is not absence)"
elif [ "$THREADS" -gt 0 ] 2>/dev/null; then
    fail "$THREADS unresolved review thread(s)"
else
    pass "no unresolved review threads"
fi

# 5. THE 1842 CASE: any comment by someone other than the author, not yet answered
#    by a later push. A maintainer's plain comment is blocking even though GitHub
#    gives it no mechanical weight.
#    Ignore ChatGPT Codex connector noise (usage-limit replies are not review asks).
PUSHED_AT="$("$REAL_GH" api "repos/$REPO/commits/$HEAD" --jq '.commit.committer.date' 2>/dev/null || echo "")"
CMTS_JSON="$("$REAL_GH" pr view "$PR" --repo "$REPO" --json comments 2>/dev/null || echo "")"
if [ -z "$CMTS_JSON" ]; then
    OTHERS="ERR"
else
    OTHERS="$(jq -r --arg me "$AUTHOR" --arg since "${PUSHED_AT:-1970-01-01T00:00:00Z}" \
        '[.comments[]?
          | select(.author.login != $me)
          | select(.createdAt > $since)
          | select(.author.login != "chatgpt-codex-connector")
          | select(.body | test("usage limits for code reviews") | not)
          | .author.login] | unique | join(", ")' \
        <<<"$CMTS_JSON" 2>/dev/null || echo "ERR")"
fi
if [ "$OTHERS" = "ERR" ]; then
    fail "could not read PR comments (treating as blocking)"
elif [ -n "$OTHERS" ]; then
    fail "unanswered comment(s) since last push from: $OTHERS — read the thread, address or reply, then push"
else
    pass "no unanswered comments since last push"
fi

# 6. operator-private paths must never reach an UPSTREAM PR (fork main may keep them)
UPSTREAM_REPO="${HAPI_UPSTREAM_REPO:-tiann/hapi}"
if [ "$REPO" = "$UPSTREAM_REPO" ]; then
    LEAK=$(jq -r '.files[].path' <<<"$META" | grep -E '^(docs/operator/|docs/plans/|CLAUDE\.md$)' | head -3 || true)
    [ -z "$LEAK" ] && pass "no operator-private paths in upstream diff" \
        || fail "operator-private paths in upstream diff: $(tr '\n' ' ' <<<"$LEAK")"
else
    pass "fork repo — operator docs/plans allowed on $REPO"
fi

# 7. LANE POLICY — upstream merges need explicit, per-PR, single-use operator authorisation
if [ "$REPO" = "$UPSTREAM_REPO" ]; then
    TOKDIR="${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}"
    TOK="$TOKDIR/$PR.auth"
    if [ ! -f "$TOK" ]; then
        fail "LANE B: no operator authorisation for $UPSTREAM_REPO#$PR (agents are prepare-only)"
        echo "         operator grants with: hapi-laneb-authorise $PR $HEAD" >&2
    else
        TOKSHA=$(awk -F= '/^head=/{print $2}' "$TOK")
        TOKEXP=$(awk -F= '/^expires=/{print $2}' "$TOK")
        NOW=$(date -u +%s)
        if [ "$TOKSHA" != "$HEAD" ]; then
            fail "LANE B: authorisation was for ${TOKSHA:0:9}, head is now ${HEAD:0:9} — re-authorise after a push"
        elif [ -n "$TOKEXP" ] && [ "$NOW" -gt "$TOKEXP" ]; then
            fail "LANE B: authorisation expired"
        else
            pass "LANE B authorisation valid for ${HEAD:0:9}"
        fi
    fi
else
    pass "not $UPSTREAM_REPO — lane policy N/A"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [ "$FAIL" -ne 0 ]; then
    echo "  RESULT: BLOCKED — do not merge. Fix the items above." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 3
fi
echo "  RESULT: PASS" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
# single-use: consume the lane B token so one grant cannot merge twice
if [ "$REPO" = "$UPSTREAM_REPO" ] && [ -f "${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}/$PR.auth" ]; then
    mv "${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}/$PR.auth" \
       "${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}/$PR.auth.used" 2>/dev/null || true
fi
exit 0
