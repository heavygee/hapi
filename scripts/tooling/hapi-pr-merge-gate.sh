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
# WARNING — Lane B grant is single-use and is consumed on every RESULT: PASS,
# including a standalone preview run. Never pre-run this gate against a live
# grant "just to check" and then expect `gh pr merge` to still have the token;
# re-grant with hapi-laneb-authorise, or only run the gate as part of the merge
# wrapper. (Exit-reflection Promote? from #1598 / 2026-11-02.)
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
#    Ignore `dogfooded since …` stamps (#2083) — those are merge-intent receipts,
#    not asks; blocking on them breaks fire-and-forget dogfood merges.
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
          | select(.body | test("dogfooded since"; "i") | not)
          | select(.body | test("New tracker: #|Related tracker: #"; "i") | not)
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

# 7. DOGFOODED 48h OPT-OUT WINDOW (discussions/2083)
# Attaching `dogfooded` starts a 48h UTC countdown. Merge is blocked until the
# window elapses — even with a valid lane B grant. low-impact-only PRs skip this.
# shellcheck source=lib/dogfood-countdown.sh
_GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_DF_LIB=""
for _cand in "$_GATE_DIR/lib/dogfood-countdown.sh" \
             "${HOME}/coding/hapi/scripts/tooling/lib/dogfood-countdown.sh" \
             "/work/coding/hapi/scripts/tooling/lib/dogfood-countdown.sh"; do
    if [ -f "$_cand" ]; then _DF_LIB="$_cand"; break; fi
done
[ -n "$_DF_LIB" ] || { echo "GATE FAIL: dogfood-countdown.sh not found" >&2; exit 2; }
# shellcheck source=/dev/null
source "$_DF_LIB"
LABELS_CSV="$("$REAL_GH" pr view "$PR" --repo "$REPO" --json labels -q '[.labels[].name]|join(",")' 2>/dev/null || echo "")"
DF_STATUS=""
if [ "$REPO" = "$UPSTREAM_REPO" ] && dogfood_has_label "$LABELS_CSV"; then
    DF_LINE="$(dogfood_status_for_pr "$REPO" "$PR" "$LABELS_CSV")"
    DF_STATUS="${DF_LINE%%$'\t'*}"
    case "$DF_STATUS" in
        waiting)
            DF_HUMAN="$(printf '%s' "$DF_LINE" | cut -f3)"
            fail "dogfooded countdown: ${DF_HUMAN} remaining (48h UTC from label; see discussions/2083)"
            ;;
        ready)
            pass "dogfooded window elapsed (48h UTC)"
            ;;
        unknown)
            fail "dogfooded label present but no labeled-at stamp (events API / 'dogfooded since' comment)"
            ;;
        *)
            fail "dogfooded status unreadable: $DF_STATUS"
            ;;
    esac
else
    pass "no dogfooded label — 48h window N/A"
fi

# 8. LANE POLICY — upstream merges need operator authorisation
#
# Two fire-and-forget-compatible paths (2026-11-03):
#
#   A. **dogfooded ready** — attaching `dogfooded` + stamp *is* merge intent
#      (discussions/2083). After the 48h UTC window (check 7 already passed
#      `ready`), that intent is sufficient lane-B auth. Opt-out = remove the
#      label (+ rationale on #2083). No second TTY `hapi-laneb-authorise`.
#      Tip may move during the window; three-dim CLEAN on the merge tip still
#      required by checks above.
#
#   B. **hapi-laneb-authorise** — single-use, SHA-bound, short TTL. Still used
#      for `low-impact` / allowlist / immediate merges without a dogfood window.
#
# The operator may grant (B) on oos-linux or homelab while merge runs from an
# agent on oos-linux. Check local first, then SSH peer hosts. Fails closed.
TOKDIR="${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}"
LANEB_REMOTE_HOSTS="${HAPI_LANEB_REMOTE_HOSTS:-homelab}"
LANEB_VIA_DOGFOOD=0

# Sets LANEB_GRANT_CONTENT and LANEB_GRANT_HOST ("" = local) on success; returns 1 if not found anywhere.
_laneb_find_grant() {
    local pr="$1"
    if [ -f "$TOKDIR/$pr.auth" ]; then
        LANEB_GRANT_CONTENT="$(cat "$TOKDIR/$pr.auth")"
        LANEB_GRANT_HOST=""
        return 0
    fi
    local h content
    for h in $LANEB_REMOTE_HOSTS; do
        content="$(ssh -o ConnectTimeout=5 -o BatchMode=yes "$h" "cat '$TOKDIR/$pr.auth' 2>/dev/null" 2>/dev/null || true)"
        if [ -n "$content" ]; then
            LANEB_GRANT_CONTENT="$content"
            LANEB_GRANT_HOST="$h"
            return 0
        fi
    done
    return 1
}

if [ "$REPO" = "$UPSTREAM_REPO" ]; then
    # Reuse DF_STATUS from check 7 when present (dogfooded ready ≡ laneb).
    if [ "${DF_STATUS:-}" = "ready" ]; then
        LANEB_VIA_DOGFOOD=1
        pass "LANE B via dogfooded (window elapsed; label-as-intent — discussions/2083)"
    elif ! _laneb_find_grant "$PR"; then
        fail "LANE B: no operator authorisation for $UPSTREAM_REPO#$PR (agents are prepare-only)"
        echo "         dogfooded: wait for 48h window, or grant: hapi-laneb-authorise $PR $HEAD" >&2
    else
        TOKSHA=$(awk -F= '/^head=/{print $2}' <<<"$LANEB_GRANT_CONTENT")
        TOKEXP=$(awk -F= '/^expires=/{print $2}' <<<"$LANEB_GRANT_CONTENT")
        NOW=$(date -u +%s)
        WHERE="${LANEB_GRANT_HOST:-local}"
        if [ "$TOKSHA" != "$HEAD" ]; then
            fail "LANE B: authorisation on $WHERE was for ${TOKSHA:0:9}, head is now ${HEAD:0:9} — re-authorise after a push"
        elif [ -n "$TOKEXP" ] && [ "$NOW" -gt "$TOKEXP" ]; then
            fail "LANE B: authorisation on $WHERE expired"
        else
            pass "LANE B authorisation valid for ${HEAD:0:9} (granted on $WHERE)"
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
# single-use: consume the lane B token so one grant cannot merge twice — wherever it was granted
# (standalone preview PASS also consumes — see header WARNING).
# Dogfood-ready path has no laneb token to consume (label-as-intent).
if [ "$REPO" = "$UPSTREAM_REPO" ] && [ "${LANEB_VIA_DOGFOOD:-0}" -ne 1 ]; then
    if [ -n "${LANEB_GRANT_HOST:-}" ]; then
        if ssh -o ConnectTimeout=5 -o BatchMode=yes "$LANEB_GRANT_HOST" \
            "test -f '$TOKDIR/$PR.auth'" 2>/dev/null; then
            echo "  note: consuming lane B grant for #$PR (single-use; re-grant if this was only a preview)" >&2
        fi
        ssh -o ConnectTimeout=5 -o BatchMode=yes "$LANEB_GRANT_HOST" \
            "mv '$TOKDIR/$PR.auth' '$TOKDIR/$PR.auth.used' 2>/dev/null" 2>/dev/null || true
    elif [ -f "$TOKDIR/$PR.auth" ]; then
        echo "  note: consuming lane B grant for #$PR (single-use; re-grant if this was only a preview)" >&2
        mv "$TOKDIR/$PR.auth" "$TOKDIR/$PR.auth.used" 2>/dev/null || true
    fi
fi
exit 0
