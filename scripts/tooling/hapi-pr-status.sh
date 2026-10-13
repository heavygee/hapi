#!/usr/bin/env bash
# hapi-pr-status — comprehensive PR hygiene check
#
# Usage: hapi-pr-status <PR_NUMBER> [--repo owner/repo]
#
# Checks three dimensions that must ALL pass before a PR is "clean":
#   1. CI checks    — gh pr checks (did the bot workflow pass on the latest commit?)
#   2. Threads      — zero unresolved review threads (gh pr checks does NOT cover these)
#   3. Bot verdict  — latest bot review/comment summary explicitly says no findings
#
# Background: the bot posts NEW inline threads on every push rather than updating
# old ones. gh pr checks only reflects whether the CI check workflow passed on the
# latest commit. A PR with checks=green can still have 20 unresolved bot threads
# from earlier pushes. This script is the single source of truth.
#
# Bot surface detection (auto):
#   - tiann/hapi (upstream): bot is `github-actions[bot]` posting FORMAL REVIEWS
#     via the openai/codex-action@v1 GitHub Action (.github/workflows/codex-pr-review.yml).
#     Clean signal: review body matches /No findings|…|No Blocker, Major, Minor, or Nit findings/
#     (HAPI Bot's clean Findings line — do not treat Questions "- None." as clean; #1108).
#   - heavygee/hapi (fork, cloud-Codex auto-review): bot is `chatgpt-codex-connector`
#     posting formal REVIEWS (`### 💡 Codex Review`) and/or ISSUE COMMENTS via the
#     ChatGPT subscription-side App. Clean signal: tip-matched review with no-findings
#     body / 👍, OR operator `cold-review-clean` **only after a tip-matched wave**.
#   - `cold-review-clean` does NOT skip unresolved threads, and does NOT excuse a tip
#     that has moved past the latest Codex "Reviewed commit" (agents must wait for /
#     clear the next wave). Usage-limit comments are not a clean verdict.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/require-gh-version.sh
source "$SCRIPT_DIR/lib/require-gh-version.sh"
require_gh_version

PR="${1:-}"
if [[ -z "$PR" ]]; then
    echo "Usage: hapi-pr-status <PR_NUMBER> [--repo owner/repo]" >&2
    exit 1
fi
shift

REPO="${HAPI_PR_REPO:-tiann/hapi}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

OWNER="$(echo "$REPO" | cut -d/ -f1)"
NAME="$(echo "$REPO"  | cut -d/ -f2)"

PASS=0  # 0 = all good so far
CHECKS_OK=true
THREADS_OK=true
BOT_OK=true

# Operator override — fetch once; also softens CI when GH returns empty rollup / 503.
HAS_CLEAN_LABEL=$(gh pr view "$PR" --repo "$REPO" --json labels \
    --jq '[.labels[].name] | contains(["cold-review-clean"])' 2>/dev/null || echo "false")

echo ""
echo "  PR #${PR} — ${REPO}"
echo "  ══════════════════════════════════════"

# ── 1. CI checks ────────────────────────────────────────────────────────────
# Fail closed: never treat missing/empty check data as PASS (Debian gh 2.23
# rejected --json; old code swallowed that and printed a green lie).
echo ""
echo "  1. CI checks"
CHECKS_ERR="$(mktemp)"
CHECKS_JSON="$(gh pr checks "$PR" --repo "$REPO" --json name,bucket 2>"$CHECKS_ERR" || true)"
if ! printf '%s' "$CHECKS_JSON" | jq -e 'type == "array"' >/dev/null 2>&1; then
    if [[ "$HAS_CLEAN_LABEL" == "true" ]]; then
        echo "     ~ could not read checks (gh outage / transport)"
        sed 's/^/       /' "$CHECKS_ERR" >&2 || true
        rm -f "$CHECKS_ERR"
        echo "     → PASS (cold-review-clean — operator attested; no rollup)"
    else
        echo "     ✗ could not read checks (gh pr checks --json failed)"
        sed 's/^/       /' "$CHECKS_ERR" >&2 || true
        rm -f "$CHECKS_ERR"
        echo "     → FAIL (no check data — refuse to invent PASS)"
        CHECKS_OK=false
        PASS=1
    fi
else
    rm -f "$CHECKS_ERR"
    CHECK_COUNT="$(printf '%s' "$CHECKS_JSON" | jq 'length')"
    if [[ "$CHECK_COUNT" -eq 0 ]]; then
        if [[ "$HAS_CLEAN_LABEL" == "true" ]]; then
            echo "     ~ zero checks returned (empty rollup)"
            echo "     → PASS (cold-review-clean — operator attested; no rollup)"
        else
            echo "     ✗ zero checks returned"
            echo "     → FAIL (empty rollup — refuse to invent PASS)"
            CHECKS_OK=false
            PASS=1
        fi
    else
        while IFS= read -r row; do
            cname=$(echo "$row" | jq -r '.name')
            bucket=$(echo "$row" | jq -r '.bucket')
            case "$bucket" in
                pass)                   echo "     ✓ $cname" ;;
                skipping)               echo "     - $cname (skipped, not a failure)" ;;
                pending|queued|in_progress)
                                        echo "     … $cname (running)"
                                        CHECKS_OK=false ;;
                *)                      echo "     ✗ $cname ($bucket)"
                                        CHECKS_OK=false ;;
            esac
        done < <(echo "$CHECKS_JSON" | jq -c '.[]')
        if $CHECKS_OK; then echo "     → PASS"; else echo "     → FAIL / PENDING"; PASS=1; fi
    fi
fi

# ── 2. Unresolved review threads ────────────────────────────────────────────
echo ""
echo "  2. Unresolved review threads"
# Paginate: #1108 had 120 threads; first-100-only missed tip-bot Majors on page 2
# and Meta chip said ⚠️ while this script reported CLEAN.
COUNT=0
THREAD_SNIPS=()
cursor=""
has_next=true
while [[ "$has_next" == "true" ]]; do
    if [[ -n "$cursor" ]]; then
        PAGE_JSON=$(gh api graphql -f query="
query(\$cursor: String!) {
  repository(owner: \"${OWNER}\", name: \"${NAME}\") {
    pullRequest(number: ${PR}) {
      reviewThreads(first: 100, after: \$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) { nodes { body } }
        }
      }
    }
  }
}" -f cursor="$cursor")
    else
        PAGE_JSON=$(gh api graphql -f query="
{
  repository(owner: \"${OWNER}\", name: \"${NAME}\") {
    pullRequest(number: ${PR}) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) { nodes { body } }
        }
      }
    }
  }
}")
    fi
    while IFS= read -r line; do
        [[ -n "$line" ]] || continue
        THREAD_SNIPS+=("$line")
        COUNT=$((COUNT + 1))
    done < <(echo "$PAGE_JSON" | jq -r '
      .data.repository.pullRequest.reviewThreads.nodes[]
      | select(.isResolved == false)
      | "· [" + .id + "]  " + (.comments.nodes[0].body // "" | .[0:90])
    ')
    has_next=$(echo "$PAGE_JSON" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
    cursor=$(echo "$PAGE_JSON" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')
    [[ "$has_next" == "true" && -n "$cursor" ]] || has_next=false
done

if [[ "$COUNT" -eq 0 ]]; then
    echo "     ✓ 0 unresolved threads"
    echo "     → PASS"
else
    echo "     ✗ ${COUNT} unresolved thread(s):"
    for snip in "${THREAD_SNIPS[@]}"; do
        echo "       $snip"
    done
    echo "     → FAIL"
    THREADS_OK=false
    PASS=1
fi

# ── 3. Latest bot verdict ───────────────────────────────────────────────────
# Surface-aware: upstream uses formal reviews by github-actions[bot]; fork uses
# chatgpt-codex-connector reviews (+ issue comments). Operator label
# `cold-review-clean` may override FINDINGS on a tip-matched wave only — never
# unresolved threads (section 2) and never a tip that has moved past Codex.
echo ""
echo "  3. Latest bot verdict"

HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null || true)

# IMPORTANT: never `gh api --paginate --jq '…|.[0]'` — --jq runs per page and
# concatenates JSON values, so jq streaming can mix tip + prior-page tip
# (false CLEAN when an older page ended Findings:None, or false FINDINGS when
# an older page still had [Major]). --slurp + jq `add` merges pages first.
if [[ "$OWNER" == "heavygee" ]]; then
    # Fork: prefer formal Codex reviews (### 💡 Codex Review + Reviewed commit);
    # fall back to issue-comments (usage-limit notices, older shapes).
    LATEST_REVIEW=$(gh api "repos/${REPO}/pulls/${PR}/reviews" --paginate --slurp 2>/dev/null \
        | jq '[add[]
            | select((.user.login == "chatgpt-codex-connector[bot]"
                or .user.login == "chatgpt-codex-connector")
                and ((.body // "") | test("Codex Review|Reviewed commit")))]
            | sort_by(.submitted_at) | reverse | .[0] // null' \
        2>/dev/null || echo "null")
    LATEST_COMMENT=$(gh api "repos/${REPO}/issues/${PR}/comments" --paginate --slurp 2>/dev/null \
        | jq '[add[]
            | select(.user.login == "chatgpt-codex-connector[bot]"
                or .user.login == "chatgpt-codex-connector")]
            | sort_by(.created_at) | reverse | .[0] // null' \
        2>/dev/null || echo "null")
    CLEAN_REGEX="Codex Review:.*Didn.t find any|Codex Review:.*No.*issues|Didn.t find any major|No reportable (code )?issues found|No findings"
    BOT_DESC="chatgpt-codex-connector[bot]"
    USAGE_LIMIT=false
    if [[ "$LATEST_COMMENT" != "null" && -n "$LATEST_COMMENT" ]]; then
        CMT_BODY=$(echo "$LATEST_COMMENT" | jq -r '.body // empty')
        if printf '%s' "$CMT_BODY" | grep -qiE 'usage limits for code reviews|Codex usage limits'; then
            USAGE_LIMIT=true
        fi
    fi
    REVIEWED_SHA=""
    SUBMITTED=""
    BODY=""
    if [[ "$LATEST_REVIEW" != "null" && -n "$LATEST_REVIEW" ]]; then
        SUBMITTED=$(echo "$LATEST_REVIEW" | jq -r '.submitted_at')
        BODY=$(echo "$LATEST_REVIEW" | jq -r '.body // empty')
        REVIEWED_SHA=$(printf '%s' "$BODY" | grep -oE 'Reviewed commit:\*\* `[0-9a-f]{7,40}`|Reviewed commit: `[0-9a-f]{7,40}`' \
            | head -1 | grep -oE '[0-9a-f]{7,40}' | head -1)
        echo "     Source: ${BOT_DESC} review"
        echo "     Last run: ${SUBMITTED}"
        [[ -n "$REVIEWED_SHA" ]] && echo "     Reviewed commit: ${REVIEWED_SHA}"
        echo "$BODY" | head -c 300 | sed 's/^/     /'
        echo ""
    elif [[ "$LATEST_COMMENT" != "null" && -n "$LATEST_COMMENT" ]]; then
        SUBMITTED=$(echo "$LATEST_COMMENT" | jq -r '.created_at')
        BODY=$(echo "$LATEST_COMMENT" | jq -r '.body // empty')
        echo "     Source: ${BOT_DESC} comment"
        echo "     Last run: ${SUBMITTED}"
        echo "$BODY" | head -c 300 | sed 's/^/     /'
        echo ""
    else
        echo "     ? No ${BOT_DESC} review/comment found"
        BODY=""
    fi

    TIP_MATCHED=false
    TIP_AHEAD=false
    if [[ -n "$HEAD_SHA" && -n "$REVIEWED_SHA" ]]; then
        if [[ "$HEAD_SHA" == "$REVIEWED_SHA"* || "$REVIEWED_SHA" == "$HEAD_SHA"* ]]; then
            TIP_MATCHED=true
        else
            TIP_AHEAD=true
        fi
        echo "     Tip HEAD: ${HEAD_SHA:0:12}  tip-matched=$TIP_MATCHED tip-ahead=$TIP_AHEAD"
    elif [[ -n "$HEAD_SHA" && -z "$REVIEWED_SHA" && "$LATEST_REVIEW" != "null" ]]; then
        # Review present but no parsed SHA — treat as unknown match
        echo "     Tip HEAD: ${HEAD_SHA:0:12}  (could not parse Reviewed commit from body)"
    fi

    if $TIP_AHEAD; then
        echo "     ✗ Tip moved past latest Codex Reviewed commit (${REVIEWED_SHA:0:12})"
        if $USAGE_LIMIT; then
            echo "     ~ also: latest Codex comment is a usage-limit notice"
        fi
        echo "     → FAIL (wait for tip-matched Codex wave or @codex review — cold-review-clean does not skip tip-ahead)"
        BOT_OK=false
        PASS=1
    elif $USAGE_LIMIT && ! $TIP_MATCHED; then
        echo "     ✗ Codex usage-limited (latest comment) and no tip-matched review"
        echo "     → FAIL (wait for quota / tip-matched Codex wave — cold-review-clean does not skip this)"
        BOT_OK=false
        PASS=1
    elif [[ -z "$BODY" ]]; then
        if [[ "$HAS_CLEAN_LABEL" == "true" ]]; then
            echo "     ✓ cold-review-clean label present (operator override; no bot body)"
            echo "     → PASS"
        else
            echo "     → UNKNOWN"
            BOT_OK=false
            PASS=1
        fi
    elif printf '%s' "$BODY" | sed 's/\\n/ /g' | tr '\n' ' ' | grep -qE "$CLEAN_REGEX"; then
        echo "     → PASS (tip-matched clean body)"
    elif [[ "$HAS_CLEAN_LABEL" == "true" ]] && { $TIP_MATCHED || [[ -z "$REVIEWED_SHA" ]]; }; then
        # Override only when this wave is tip-matched (or unparseable SHA on current review).
        echo "     ✓ cold-review-clean label present (operator override on tip-matched/accepted wave)"
        echo "     → PASS"
    else
        echo "     → FINDINGS PRESENT (clear threads + tip-matched clean, or apply cold-review-clean after addressing)"
        BOT_OK=false
        PASS=1
    fi
else
    # Upstream: openai/codex-action GHA posts formal reviews as github-actions[bot]
    LATEST_BOT=$(gh api "repos/${REPO}/pulls/${PR}/reviews" --paginate --slurp 2>/dev/null \
        | jq '[add[]
            | select(.user.login == "github-actions[bot]")]
            | sort_by(.submitted_at) | reverse | .[0] // null' \
        2>/dev/null || echo "null")
    # Do NOT match bare "- None." — Codex puts that under **Questions** even
    # when Findings still has Majors (#1108). Include HAPI Bot's clean line
    # ("No Blocker, Major, Minor, or Nit findings…") which lacks "No findings".
    # Allow blank line(s) between **Findings** and "- None." (HAPI Bot often
    # emits that shape; a strict \\n- None false-positived #1274 as dirty).
    # "No reportable code issues found" (#1163 Codex v2 Code section) — not
    # contiguous with older "No reportable issues found".
    CLEAN_REGEX="No findings|No high-confidence|No issues found|No reportable (code )?issues found|No additional actionable|No actionable|No Blocker, Major, Minor, or Nit findings|No Blocker[[:space:]].*findings|\*\*Findings\*\*[[:space:]]*- None"
    BOT_DESC="github-actions[bot] review"

    if [[ "$HAS_CLEAN_LABEL" == "true" ]]; then
        echo "     ✓ cold-review-clean label present (operator override)"
        echo "     → PASS"
    elif [[ "$LATEST_BOT" == "null" || -z "$LATEST_BOT" ]]; then
        echo "     ? No ${BOT_DESC} found"
        echo "     → UNKNOWN"
        BOT_OK=false
        PASS=1
    else
        SUBMITTED=$(echo "$LATEST_BOT" | jq -r '.submitted_at')
        BODY=$(echo "$LATEST_BOT" | jq -r '.body // empty')
        SNIPPET=$(echo "$LATEST_BOT" | jq -r '.body[0:300]')
        echo "     Source: ${BOT_DESC}"
        echo "     Last run: ${SUBMITTED}"
        echo "$SNIPPET" | sed 's/^/     /'
        # Match full body — clean verdict often sits after Requirement/Approach
        # (#1163 false FINDINGS when only body[0:300] was searched).
        # grep is line-oriented; HAPI Bot puts "**Findings**" and "- None." on
        # separate lines, so flatten before matching (otherwise false dirty).
        # Some tip-bot payloads also embed literal backslash-n sequences
        # (not real newlines) — flatten those too (#1108 2026-08-04).
        if printf '%s' "$BODY" | sed 's/\\n/ /g' | tr '\n' ' ' | grep -qE "$CLEAN_REGEX"; then
            echo "     → PASS"
        else
            echo "     → FINDINGS PRESENT (apply 'cold-review-clean' label to override after addressing)"
            BOT_OK=false
            PASS=1
        fi
    fi
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo ""
echo "  ══════════════════════════════════════"
if [[ "$PASS" -eq 0 ]]; then
    echo "  ✅  PR #${PR} is CLEAN — all three dimensions pass"
else
    echo "  ❌  PR #${PR} is NOT clean:"
    $CHECKS_OK  || echo "     • CI checks failing or pending"
    $THREADS_OK || echo "     • ${COUNT} unresolved review thread(s) — resolve with GraphQL resolveReviewThread mutation"
    $BOT_OK     || echo "     • Bot review has findings or is absent"
fi
echo "  ══════════════════════════════════════"
echo ""

exit "$PASS"
