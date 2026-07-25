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

export GH_FORCE_TTY=0 GIT_TERMINAL_PROMPT=0 GH_PAGER=cat PAGER=cat

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
CORE_LIB="$SCRIPT_DIR/lib/pr-emoji-core.sh"
# shellcheck source=lib/pr-emoji-core.sh
source "$CORE_LIB"
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
    timeout --foreground -k 3 "${TIMEOUT}s" gh "$@"
}

fetch_latest_bot_body() {
    local n="$1" label
    label="$(gh_t pr view "$n" --repo "$REPO" --json labels \
        --jq '[.labels[].name]|contains(["cold-review-clean"])' 2>/dev/null || echo false)"
    [[ "$label" == "true" ]] && { echo "__CLEAN_LABEL__"; return 0; }
    if [[ "$OWNER" == "heavygee" ]]; then
        gh_t api "repos/${REPO}/issues/${n}/comments" --paginate \
            --jq '[.[]|select(.user.login|test("^chatgpt-codex-connector"))]|sort_by(.created_at)|last|.body//""' \
            2>/dev/null || echo ""
    else
        gh_t api "repos/${REPO}/pulls/${n}/reviews" --paginate \
            --jq '[.[]|select(.user.login=="github-actions[bot]")]|sort_by(.submitted_at)|last|.body//""' \
            2>/dev/null || echo ""
    fi
}

# Emit the per-PR JSON blob. All signal bits are 0/1 strings; jq converts.
_emit_pr_json() {
    local out="$1" emoji="$2" action="$3" exists="$4" merged="$5" closed="$6" \
        prepr="$7" data_unavail="$8" threads="$9" checks_ok="${10}" \
        checks_pending="${11}" checks_seen="${12}" bot_clean="${13}" \
        bot_major="${14}" merge_state="${15}"
    local in_queue=true
    [[ "$exists" == "1" && "$merged" == "0" && "$closed" == "0" && "$data_unavail" == "0" ]] || in_queue=false
    b() { [[ "$1" == "1" ]] && echo true || echo false; }
    jq -n \
        --arg emoji "$emoji" --arg action "$action" --arg merge "$merge_state" \
        --argjson exists "$(b "$exists")" --argjson merged "$(b "$merged")" \
        --argjson closed "$(b "$closed")" --argjson prePr "$(b "$prepr")" \
        --argjson dataUnavailable "$(b "$data_unavail")" \
        --argjson inQueue "$in_queue" --argjson open "$in_queue" \
        --argjson threads "$threads" \
        --argjson checksOk "$(b "$checks_ok")" --argjson checksPending "$(b "$checks_pending")" \
        --argjson checksSeen "$(b "$checks_seen")" \
        --argjson botClean "$(b "$bot_clean")" --argjson botMajor "$(b "$bot_major")" \
        '{emoji:$emoji,exists:$exists,inQueue:$inQueue,open:$inQueue,prePr:$prePr,merged:$merged,closed:$closed,dataUnavailable:$dataUnavailable,threads:$threads,checksOk:$checksOk,checksPending:$checksPending,checksSeen:$checksSeen,botClean:$botClean,botMajor:$botMajor,mergeState:$merge,action:$action}' \
        >"$out"
}

# Derive CI signals. Requires gh >= HAPI_GH_MIN_VERSION (see require-gh-version.sh).
#   Prints: "<checks_ok> <checks_pending> <checks_seen> <pr_review_ok>"
# Uses `gh pr checks --json name,bucket` only — no human-table fallback (that
# path lied when --json was unsupported).
_gh_check_signals() {
    local n="$1" json
    local checks_ok=1 checks_pending=0 checks_seen=0 pr_review_ok=0
    if json="$(gh_t pr checks "$n" --repo "$REPO" --json name,bucket 2>/dev/null)" \
        && [[ "${json:0:1}" == "[" ]]; then
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
        done < <(echo "$json" | jq -c '.[]' 2>/dev/null || true)
        echo "$checks_ok $checks_pending $checks_seen $pr_review_ok"
        return
    fi
    # No JSON → treat as data unavailable (caller maps to ? / 🔁), never invent green.
    # Legacy human-table fallback removed 2026-07-25 (Debian 2.23 false PASS).
    echo "0 0 0 0"
}

classify_one() {
    local n="$1"
    local out="$TMPDIR/$n.json"
    local merge_state pr_state pr_json bot_body
    local checks_ok=1 checks_pending=0 checks_seen=0 pr_review_ok=0 threads_n bot_clean=0 bot_major=0 bot_has_body=0 merge_bad=0
    local exists=0 merged=0 closed=0 data_unavail=0
    local decided emoji action

    # Single authoritative PR fetch. Distinguish a real 404 (pre-PR) from a
    # transport failure (timeout / network) — the latter must NOT masquerade as
    # pre-PR, or a flaky network would retitle live PRs to 📝. Guard the command
    # substitution in an `if` so `set -e` does not kill us on the 404 exit.
    local err_out rc=0
    if err_out="$(gh_t api "repos/${REPO}/pulls/${n}" \
        --jq '[.state, (.merged|tostring), (.mergeable_state // "unknown")] | @tsv' 2>&1)"; then
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
    IFS=$'\t' read -r pr_state pr_json merge_state <<< "$err_out"
    [[ "$pr_json" == "true" ]] && merged=1
    [[ "$pr_state" == "closed" && "$merged" -eq 0 ]] && closed=1
    [[ "$merge_state" == "dirty" || "$merge_state" == "behind" ]] && merge_bad=1

    if [[ "$merged" -eq 1 ]]; then
        decided="$(pec_decide_emoji 1 1 0 1 0 1 0 1 0 0 0 0)"
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 1 1 0 0 0 0 1 0 1 1 0 "MERGED"
        return
    fi
    if [[ "$closed" -eq 1 ]]; then
        decided="$(pec_decide_emoji 1 0 1 0 0 0 0 0 0 0 0 0)"
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 1 0 1 0 0 -1 0 0 0 0 0 "$merge_state"
        return
    fi

    read -r checks_ok checks_pending checks_seen pr_review_ok < <(_gh_check_signals "$n")

    threads_n="$(gh_t api graphql -f query="
query { repository(owner:\"${OWNER}\", name:\"${NAME}\") {
  pullRequest(number: ${n}) { reviewThreads(first: 50) { nodes { isResolved } } }
}}" --jq 'if .data.repository.pullRequest == null then empty else [.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length end' 2>/dev/null || true)"
    if [[ -z "$threads_n" || ! "$threads_n" =~ ^[0-9]+$ ]]; then
        threads_n=-1
    fi

    bot_body="$(fetch_latest_bot_body "$n")"
    if [[ "$bot_body" == "__CLEAN_LABEL__" ]]; then
        bot_clean=1
        bot_body=""
    elif echo "$bot_body" | grep -qiE 'No findings|No high-confidence|No issues found|No actionable|Didn.t find any|No new issues found|Findings.*None'; then
        bot_clean=1
    elif [[ "$pr_review_ok" -eq 1 ]]; then
        bot_clean=1
    fi
    [[ -n "$bot_body" ]] && bot_has_body=1
    if echo "$bot_body" | grep -qiE '\[Major\]|\[MAJOR\]'; then
        bot_major=1
        [[ "$pr_review_ok" -eq 1 ]] && bot_clean=1 && bot_major=0
    fi

    decided="$(pec_decide_emoji 1 0 0 "$checks_ok" "$checks_pending" "$checks_seen" \
        "$threads_n" "$bot_clean" "$bot_major" "$bot_has_body" "$merge_bad" 0)"
    emoji="${decided%%$'\t'*}"
    action="${decided#*$'\t'}"

    _emit_pr_json "$out" "$emoji" "$action" 1 0 0 0 0 "$threads_n" \
        "$checks_ok" "$checks_pending" "$checks_seen" "$bot_clean" "$bot_major" "$merge_state"
}

export REPO OWNER NAME TIMEOUT TMPDIR WALL_LIMIT
export -f classify_one gh_t fetch_latest_bot_body _emit_pr_json pec_decide_emoji _gh_check_signals

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
