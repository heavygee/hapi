#!/usr/bin/env bash
# hapi-pr-emoji-batch — classify PRs for session emoji (bash, parallel, small gh calls).
#
# No bun. No mega-graphql. Same bot/CI logic as hapi-pr-status, parallelized.
#
# Usage:
#   hapi-pr-emoji-batch.sh [--table] [--repo owner/name] PR [PR...]
#   hapi-pr-emoji-batch.sh --table 941 923 902
#
# Env: HAPI_PR_REPO, HAPI_GH_TIMEOUT_SECS (default 15), HAPI_PR_EMOJI_PARALLEL (default 4)
# Non-TTY / agent shells: serial gh + wall-clock cap (Cursor agent hung 40m+ without this).
#
# Lives on fork main under scripts/tooling/ — commit changes here; do NOT hand-edit hapi-driver.
set -euo pipefail

REPO="${HAPI_PR_REPO:-tiann/hapi}"
TIMEOUT="${HAPI_GH_TIMEOUT_SECS:-15}"
TIMEOUT_EXPLICIT=0
[[ -n "${HAPI_GH_TIMEOUT_SECS:-}" ]] && TIMEOUT_EXPLICIT=1
PARALLEL="${HAPI_PR_EMOJI_PARALLEL:-4}"
TABLE=0
PRS=()

# NO_COLOR: under systemd, `timeout --foreground` (historically) allocated a pty
# so `gh … --json` emitted ANSI. First-char `[` checks then failed and every PR
# became fake 🔁 "no CI checks visible". Never colorize machine-readable output.
export NO_COLOR=1 CLICOLOR=0
export GH_FORCE_TTY=0 GIT_TERMINAL_PROMPT=0 GH_PAGER=cat PAGER=cat

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
CORE_LIB="$SCRIPT_DIR/lib/pr-emoji-core.sh"
# shellcheck source=lib/pr-emoji-core.sh
source "$CORE_LIB"
# shellcheck source=lib/pr-merge-policy.sh
source "$SCRIPT_DIR/lib/pr-merge-policy.sh"
MERGE_POLICY_JSON="$(pmp_load_policy)"
# shellcheck source=lib/require-gh-version.sh
source "$SCRIPT_DIR/lib/require-gh-version.sh"
require_gh_version

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO="$2"; shift 2 ;;
        --timeout) TIMEOUT="$2"; TIMEOUT_EXPLICIT=1; shift 2 ;;
        --table) TABLE=1; shift ;;
        --help|-h) sed -n '2,14p' "$0"; exit 0 ;;
        [0-9]*) PRS+=("$1"); shift ;;
        *) echo "hapi-pr-emoji-batch: unknown arg: $1" >&2; exit 2 ;;
    esac
done

[[ ${#PRS[@]} -gt 0 ]] || { echo "usage: hapi-pr-emoji-batch.sh [--table] PR..." >&2; exit 2; }

# Agent/non-TTY shells: serialize gh (anti-hang). Only shorten the timeout when
# the caller did NOT set one explicitly — an explicit --timeout must survive.
if [[ "${HAPI_AGENT_CONTEXT:-}" == 1 || ! -t 1 ]]; then
    PARALLEL=1
    [[ "$TIMEOUT_EXPLICIT" -eq 1 ]] || TIMEOUT=10
fi
WALL_LIMIT=$(( $(date +%s) + ${#PRS[@]} * TIMEOUT * 6 + 20 ))

OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
TMPDIR="${TMPDIR:-/tmp}/hapi-pr-emoji-$$"
mkdir -p "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

gh_t() {
    (( $(date +%s) < WALL_LIMIT )) || { echo "hapi-pr-emoji-batch: wall-clock limit exceeded" >&2; return 124; }
    # Do not use timeout --foreground: it can attach a pty; gh then ANSI-colors
    # --json and breaks _gh_check_signals (see NO_COLOR note above).
    timeout -k 3 "${TIMEOUT}s" gh "$@"
}

fetch_latest_bot_body() {
    local n="$1" label
    label="$(gh_t pr view "$n" --repo "$REPO" --json labels \
        --jq '[.labels[].name]|contains(["cold-review-clean"])' 2>/dev/null || echo false)"
    [[ "$label" == "true" ]] && { echo "__CLEAN_LABEL__"; return 0; }
    # IMPORTANT: never use `gh api --paginate --jq '…|last|…'`.
    # With --jq, gh filters EACH page and concatenates string outputs. On long
    # PRs (#1108 had 2+ review pages) that glues an older page's tip body onto
    # the real tip — body-grep then false-[Major] (⚠️) while tip is Findings:None.
    # --slurp cannot combine with --jq (gh 2.96); pipe pages through jq `add`.
    if [[ "$OWNER" == "heavygee" ]]; then
        gh_t api "repos/${REPO}/issues/${n}/comments" --paginate --slurp 2>/dev/null \
            | jq -r 'add
                | map(select(.user.login|test("^chatgpt-codex-connector")))
                | sort_by(.created_at)
                | last
                | .body // empty' \
            2>/dev/null || echo ""
    else
        gh_t api "repos/${REPO}/pulls/${n}/reviews" --paginate --slurp 2>/dev/null \
            | jq -r 'add
                | map(select(.user.login=="github-actions[bot]"))
                | sort_by(.submitted_at)
                | last
                | .body // empty' \
            2>/dev/null || echo ""
    fi
}

# Emit the per-PR JSON blob. All signal bits are 0/1 strings; jq converts.
# Optional mergeLane (maintainer|self_merge) for ✅ PRs — chip stays health-only.
# blockedUpstream (18) forces stickyPing:false while emoji stays ⚠️ (#128).
_emit_pr_json() {
    local out="$1" emoji="$2" action="$3" exists="$4" merged="$5" closed="$6" \
        prepr="$7" data_unavail="$8" threads="$9" checks_ok="${10}" \
        checks_pending="${11}" checks_seen="${12}" bot_clean="${13}" \
        bot_major="${14}" merge_state="${15}" merge_lane="${16:-}" \
        head_ref="${17:-}" blocked_up="${18:-0}"
    local in_queue=true sticky
    [[ "$exists" == "1" && "$merged" == "0" && "$closed" == "0" && "$data_unavail" == "0" ]] || in_queue=false
    b() { [[ "$1" == "1" ]] && echo true || echo false; }
    sticky="$(pec_default_sticky_ping "$emoji" "$blocked_up")"
    jq -n \
        --arg emoji "$emoji" --arg action "$action" --arg merge "$merge_state" \
        --arg mergeLane "$merge_lane" --arg headRef "$head_ref" \
        --argjson exists "$(b "$exists")" --argjson merged "$(b "$merged")" \
        --argjson closed "$(b "$closed")" --argjson prePr "$(b "$prepr")" \
        --argjson dataUnavailable "$(b "$data_unavail")" \
        --argjson inQueue "$in_queue" --argjson open "$in_queue" \
        --argjson threads "$threads" \
        --argjson checksOk "$(b "$checks_ok")" --argjson checksPending "$(b "$checks_pending")" \
        --argjson checksSeen "$(b "$checks_seen")" \
        --argjson botClean "$(b "$bot_clean")" --argjson botMajor "$(b "$bot_major")" \
        --argjson blockedUpstream "$(b "$blocked_up")" \
        --argjson stickyPing "$sticky" \
        '{emoji:$emoji,exists:$exists,inQueue:$inQueue,open:$inQueue,prePr:$prePr,merged:$merged,closed:$closed,dataUnavailable:$dataUnavailable,threads:$threads,checksOk:$checksOk,checksPending:$checksPending,checksSeen:$checksSeen,botClean:$botClean,botMajor:$botMajor,mergeState:$merge,action:$action,blockedUpstream:$blockedUpstream,stickyPing:$stickyPing}
         + (if ($mergeLane|length)>0 then {mergeLane:$mergeLane} else {} end)
         + (if ($headRef|length)>0 then {headRef:$headRef} else {} end)' \
        >"$out"
}

# When health is ✅, overlay estate merge-lane policy onto statusAction.
# Chip emoji stays ✅; action string becomes wait-on-tiann vs self-merge eligible.
_apply_merge_lane() {
    local n="$1" action_inout="$2"
    local meta files labs additions deletions prod_add prod_del class lane reason
    # Per-file add/del so auto-B size caps can ignore *.test.* / *.spec.* paths.
    meta="$(gh_t pr view "$n" --repo "$REPO" --json files,labels,additions,deletions \
        --jq '{files:[.files[]|{path,additions,deletions}],labels:[.labels[].name],additions,deletions}' 2>/dev/null || echo "")"
    if [[ -z "$meta" ]] || ! printf '%s' "$meta" | jq -e . >/dev/null 2>&1; then
        printf '%s\t%s' "maintainer" "$(pmp_action_for_lane maintainer "$REPO")"
        return
    fi
    files="$(printf '%s' "$meta" | jq -r '.files[].path?' )"
    labs="$(printf '%s' "$meta" | jq -r '.labels|join(",")')"
    additions="$(printf '%s' "$meta" | jq -r '.additions // 0')"
    deletions="$(printf '%s' "$meta" | jq -r '.deletions // 0')"
    # Product-only delta: drop unit/spec test paths (same rules as pmp_is_test_path).
    prod_add="$(printf '%s' "$meta" | jq '[.files[] | select(.path|test("\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$")|not) | select(.path|test("/(__tests__|__mocks__)/")|not) | .additions] | add // 0')"
    prod_del="$(printf '%s' "$meta" | jq '[.files[] | select(.path|test("\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$")|not) | select(.path|test("/(__tests__|__mocks__)/")|not) | .deletions] | add // 0')"
    class="$(pmp_classify "${MERGE_POLICY_JSON}" "$n" "$files" "$additions" "$deletions" "$labs" "$prod_add" "$prod_del")"
    lane="${class%%$'\t'*}"
    reason="${class#*$'\t'}"
    printf '%s\t%s' "$lane" "$(pmp_action_for_lane "$lane" "$REPO") (${reason})"
}

# Derive CI signals. Requires gh >= HAPI_GH_MIN_VERSION (see require-gh-version.sh).
#   Prints: "<checks_ok> <checks_pending> <checks_seen> <pr_review_ok>"
# Uses `gh pr checks --json name,bucket` only — no human-table fallback (that
# path lied when --json was unsupported).
_gh_check_signals() {
    local n="$1" json
    local checks_ok=1 checks_pending=0 checks_seen=0 pr_review_ok=0
    json="$(gh_t pr checks "$n" --repo "$REPO" --json name,bucket 2>/dev/null || true)"
    # Strip ANSI color (belt-and-suspenders if a pty sneaks back in).
    json="$(printf '%s' "$json" | sed $'s/\033\\[[0-9;]*[a-zA-Z]//g')"
    if printf '%s' "$json" | jq -e 'type == "array"' >/dev/null 2>&1; then
        local row cname bucket
        while IFS= read -r row; do
            cname="$(echo "$row" | jq -r '.name')"
            bucket="$(echo "$row" | jq -r '.bucket')"
            [[ "$cname" == "test" || "$cname" == "pr-review" ]] || continue
            checks_seen=1
            case "$bucket" in
                pass|skipping) [[ "$cname" == "pr-review" ]] && pr_review_ok=1 ;;
                pending|queued|in_progress) checks_ok=0; checks_pending=1 ;;
                *) checks_ok=0 ;;
            esac
        done < <(printf '%s' "$json" | jq -c '.[]' 2>/dev/null || true)
        echo "$checks_ok $checks_pending $checks_seen $pr_review_ok"
        return
    fi
    # No JSON → treat as data unavailable (caller maps to ? / 🔁), never invent green.
    # Legacy human-table fallback removed 2026-07-25 (Debian 2.23 false PASS).
    echo "0 0 0 0"
}

# Count actionable unresolved review threads (paginate; first:50 used to miss
# threads on long-lived PRs like #1108 with 66+ threads). Also return reviewDecision.
# Chip count EXCLUDES outdated threads (#847: Findings:None + green CI + leftover
# outdated unresolved bot Major must not force ⚠️).
# Prints: "<unresolved_count>\t<review_decision_or_empty>"
# unresolved_count is -1 on transport/parse failure.
_fetch_review_signals() {
    local n="$1"
    local cursor="" page unresolved=0 decision="" has_next=true resp page_n
    while [[ "$has_next" == "true" ]]; do
        if [[ -n "$cursor" ]]; then
            resp="$(gh_t api graphql -f query="
query(\$cursor: String) {
  repository(owner:\"${OWNER}\", name:\"${NAME}\") {
    pullRequest(number: ${n}) {
      reviewDecision
      reviewThreads(first: 100, after: \$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated }
      }
    }
  }
}" -f cursor="$cursor" 2>/dev/null || true)"
        else
            resp="$(gh_t api graphql -f query="
query {
  repository(owner:\"${OWNER}\", name:\"${NAME}\") {
    pullRequest(number: ${n}) {
      reviewDecision
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated }
      }
    }
  }
}" 2>/dev/null || true)"
        fi
        if ! printf '%s' "$resp" | jq -e '.data.repository.pullRequest' >/dev/null 2>&1; then
            printf '%s\t%s\n' "-1" ""
            return
        fi
        decision="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewDecision // empty')"
        page_n="$(printf '%s' "$resp" | jq -c '.data.repository.pullRequest.reviewThreads.nodes // []' \
            | pec_count_chip_unresolved_threads)"
        if [[ ! "$page_n" =~ ^[0-9]+$ ]]; then
            printf '%s\t%s\n' "-1" ""
            return
        fi
        unresolved=$(( unresolved + page_n ))
        has_next="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
        cursor="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')"
        [[ "$has_next" == "true" && -n "$cursor" ]] || has_next=false
    done
    printf '%s\t%s\n' "$unresolved" "$decision"
}

# Wrapper kept for export -f / classify_one; logic lives in pr-emoji-core.
_bot_body_findings_clean() {
    pec_bot_body_findings_clean "$@"
}

classify_one() {
    local n="$1"
    local out="$TMPDIR/$n.json"
    local merge_state pr_state pr_json bot_body
    local checks_ok=1 checks_pending=0 checks_seen=0 pr_review_ok=0 threads_n bot_clean=0 bot_major=0 bot_has_body=0 merge_bad=0
    local review_changes=0 review_decision=""
    local exists=0 merged=0 closed=0 data_unavail=0
    local decided emoji action

    # Single authoritative PR fetch. Include draft + labels so Meta cannot
    # paint intentional drafts / status:blocked-upstream as full green (#127).
    # Distinguish a real 404 (pre-PR) from a transport failure (timeout /
    # network) — the latter must NOT masquerade as pre-PR. Guard the command
    # substitution in an `if` so `set -e` does not kill us on the 404 exit.
    local err_out rc=0
    if err_out="$(gh_t api "repos/${REPO}/pulls/${n}" \
        --jq '[.state, (.merged|tostring), (.mergeable_state // "unknown"), (.head.ref // ""), (.draft|tostring), ([.labels[].name]|join("|")), ((.body // "")|gsub("[\t\n\r]";" "))] | @tsv' 2>&1)"; then
        rc=0
    else
        rc=$?
    fi
    if [[ "$rc" -ne 0 ]]; then
        if [[ "$rc" -eq 124 ]]; then
            data_unavail=1
        elif echo "$err_out" | grep -qiE 'not found|http 404'; then
            exists=0   # genuine pre-PR
        else
            data_unavail=1  # connection/resolve/rate-limit → unknown, be conservative
        fi
        if [[ "$data_unavail" -eq 1 ]]; then
            decided="$(pec_decide_emoji 0 0 0 0 0 0 0 0 0 0 0 1)"
            _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 0 0 0 0 1 -1 0 0 0 0 0 "UNAVAILABLE"
            return
        fi
        decided="$(pec_decide_emoji 0 0 0 0 0 0 0 0 0 0 0 0)"
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 0 0 0 1 0 -1 0 0 0 0 0 "UNKNOWN"
        return
    fi

    exists=1
    local head_ref="" draft_flag="" labels_csv="" pr_body=""
    IFS=$'\t' read -r pr_state pr_json merge_state head_ref draft_flag labels_csv pr_body <<< "$err_out"
    [[ "$pr_json" == "true" ]] && merged=1
    [[ "$pr_state" == "closed" && "$merged" -eq 0 ]] && closed=1
    [[ "$merge_state" == "dirty" || "$merge_state" == "behind" ]] && merge_bad=1

    if [[ "$merged" -eq 1 ]]; then
        decided="$(pec_decide_emoji 1 1 0 1 0 1 0 1 0 0 0 0)"
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 1 1 0 0 0 0 1 0 1 1 0 "MERGED" "" "$head_ref"
        return
    fi
    if [[ "$closed" -eq 1 ]]; then
        # Empty-vs-main → superseded exit (#958→#1405): suggest chip retarget, not rebase.
        local superseded=0 ahead_by=""
        if ahead_by="$(gh api "repos/${REPO}/compare/main...pull/${n}/head" \
            --jq '.ahead_by // empty' 2>/dev/null)" \
            && [[ "$ahead_by" == "0" ]]; then
            superseded=1
        fi
        decided="$(pec_decide_emoji 1 0 1 0 0 0 0 0 0 0 0 0 0 "$superseded")"
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 1 0 1 0 0 -1 0 0 0 0 0 "$merge_state" "" "$head_ref"
        return
    fi

    # Draft / blocked-upstream before CI/bot can invent ✅ (heavygee/hapi#127).
    # blockedUpstream bit is structured for Meta stickyPing=false (#128).
    local gate gate_emoji gate_action gate_prepr gate_blocked
    gate="$(pec_gate_draft_blocked "$draft_flag" "$labels_csv" "$pr_body")"
    if [[ -n "$gate" ]]; then
        IFS=$'\t' read -r gate_emoji gate_action gate_prepr gate_blocked <<<"$gate"
        _emit_pr_json "$out" "$gate_emoji" "$gate_action" 1 0 0 "$gate_prepr" 0 -1 0 0 0 0 0 "$merge_state" "" "$head_ref" "${gate_blocked:-0}"
        return
    fi

    read -r checks_ok checks_pending checks_seen pr_review_ok < <(_gh_check_signals "$n")

    IFS=$'\t' read -r threads_n review_decision < <(_fetch_review_signals "$n")
    if [[ -z "$threads_n" || ! "$threads_n" =~ ^-?[0-9]+$ ]]; then
        threads_n=-1
    fi
    [[ "$review_decision" == "CHANGES_REQUESTED" ]] && review_changes=1

    bot_body="$(fetch_latest_bot_body "$n")"
    if [[ "$bot_body" == "__CLEAN_LABEL__" ]]; then
        bot_clean=1
        bot_body=""
    fi
    [[ -n "$bot_body" ]] && bot_has_body=1

    # Majors first — never let Questions "- None." or pr-review check SUCCESS
    # invent bot_clean / clear bot_major (attach-time false ✅ on #1108).
    if echo "$bot_body" | grep -qiE '\[Major\]|\[MAJOR\]'; then
        bot_major=1
        bot_clean=0
    elif [[ -n "$bot_body" ]] && _bot_body_findings_clean "$bot_body"; then
        bot_clean=1
    elif [[ "$pr_review_ok" -eq 1 && "$bot_has_body" -eq 0 ]]; then
        # Check passed and no review body yet — treat as clean-enough for CI path.
        bot_clean=1
    fi

    # Resolved threads + in-flight CI/pr-review: body-grep Majors from the
    # previous review head are sticky noise — do not emit botMajor in the
    # classify JSON (decide also ignores them for emoji). Keep Majors when
    # GitHub formally requested changes.
    if [[ "$checks_pending" -eq 1 && "$threads_n" -eq 0 && "$bot_major" -eq 1 && "$review_changes" -eq 0 ]]; then
        bot_major=0
    fi

    decided="$(pec_decide_emoji 1 0 0 "$checks_ok" "$checks_pending" "$checks_seen" \
        "$threads_n" "$bot_clean" "$bot_major" "$bot_has_body" "$merge_bad" 0 "$review_changes")"
    emoji="${decided%%$'\t'*}"
    action="${decided#*$'\t'}"
    local merge_lane=""
    if [[ "$emoji" == "✅" ]]; then
        local lane_out
        lane_out="$(_apply_merge_lane "$n" "$action")"
        merge_lane="${lane_out%%$'\t'*}"
        action="${lane_out#*$'\t'}"
    fi

    _emit_pr_json "$out" "$emoji" "$action" 1 0 0 0 0 "$threads_n" \
        "$checks_ok" "$checks_pending" "$checks_seen" "$bot_clean" "$bot_major" "$merge_state" \
        "$merge_lane"
}

export REPO OWNER NAME TIMEOUT TMPDIR WALL_LIMIT MERGE_POLICY_JSON
# Path-kind helpers (pmp_path_is_*) removed with product_paths lane reject (5d23292bb);
# do not export -f names that are no longer functions — that aborts the whole batch.
export -f classify_one gh_t fetch_latest_bot_body _emit_pr_json _apply_merge_lane \
    pec_decide_emoji pec_gate_draft_blocked pec_labels_csv_has \
    pec_blocked_upstream_action pec_blocked_upstream_dep_from_body \
    pec_default_sticky_ping \
    pmp_classify pmp_action_for_lane pmp_load_policy \
    pmp_default_policy_json \
    _gh_check_signals _fetch_review_signals _bot_body_findings_clean \
    pec_count_chip_unresolved_threads

echo "hapi-pr-emoji-batch: ${#PRS[@]} PR(s), parallel=${PARALLEL}, timeout=${TIMEOUT}s, wall=$(( WALL_LIMIT - $(date +%s) ))s" >&2
t0=$(date +%s)

running=0
for n in "${PRS[@]}"; do
    while (( running >= PARALLEL )); do
        (( $(date +%s) < WALL_LIMIT )) || { echo "hapi-pr-emoji-batch: wall-clock limit during wait" >&2; running=0; break 2; }
        if wait -n 2>/dev/null; then
            running=$((running - 1))
        else
            wait || true
            running=0
        fi
    done
    classify_one "$n" &
    running=$((running + 1))
done
while (( running > 0 )); do
    (( $(date +%s) < WALL_LIMIT )) || { echo "hapi-pr-emoji-batch: wall-clock limit during final wait" >&2; break; }
    if wait -n 2>/dev/null; then
        running=$((running - 1))
    else
        wait || true
        running=0
    fi
done

echo "hapi-pr-emoji-batch: fetched in $(( $(date +%s) - t0 ))s" >&2

json="{"
first=1
for n in "${PRS[@]}"; do
    [[ -f "$TMPDIR/$n.json" ]] || continue
    [[ "$first" -eq 1 ]] || json+=","
    first=0
    json+="\"$n\":$(cat "$TMPDIR/$n.json")"
done
json+="}"

if [[ "$TABLE" -eq 1 ]]; then
    for n in "${PRS[@]}"; do
        [[ -f "$TMPDIR/$n.json" ]] || continue
        jq -r --arg n "$n" '"\(.emoji)  #\($n)  threads=\(.threads)  botClean=\(.botClean)  \(.action)"' "$TMPDIR/$n.json"
    done
else
    echo "$json" | jq -c .
fi
