#!/usr/bin/env bash
# hapi-attention-daily-sweep.sh — hourly triage under the attention umbrella.
#
# Honest progress: done/total = completed hourly sweeps (default 24),
# detail = last sweep summary. Each tick actually queries GitHub.
#
#   HAPI_SESSION_ID=… ./hapi-attention-daily-sweep.sh
# Env knobs: ATTENTION_SWEEP_TOTAL (24), ATTENTION_SWEEP_INTERVAL_SECS (3600),
# ATTENTION_SWEEP_LOG, ATTENTION_JOB_KEY, ATTENTION_PRS, ATTENTION_DISCUSSION,
# ATTENTION_ISSUE, ATTENTION_REPO

set -euo pipefail

SESSION="${HAPI_SESSION_ID:?HAPI_SESSION_ID required}"
JOB_KEY="${ATTENTION_JOB_KEY:-attention-daily-sweep}"
TOTAL="${ATTENTION_SWEEP_TOTAL:-24}"
INTERVAL="${ATTENTION_SWEEP_INTERVAL_SECS:-3600}"
LOG="${ATTENTION_SWEEP_LOG:-/tmp/hapi-attention-daily-sweep.log}"
REPO="${ATTENTION_REPO:-tiann/hapi}"
DISC="${ATTENTION_DISCUSSION:-2355}"
ISSUE="${ATTENTION_ISSUE:-2356}"
# shellcheck disable=SC2206
PRS=(${ATTENTION_PRS:-1725 1733 1772 987})

HAPI_BIN="${HAPI_BIN:-$HOME/.local/bin/hapi}"
GH_BIN="${HAPI_REAL_GH:-${REAL_GH:-gh}}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

update_job() {
    local done="$1" detail="$2"
    "$HAPI_BIN" job update "$SESSION" "$JOB_KEY" \
        --done "$done" --total "$TOTAL" --unit sweeps \
        --detail "$detail" >/dev/null 2>&1 || true
}

new_issue_comments() {
    local num="$1" since_epoch="$2"
    "$GH_BIN" api "repos/${REPO}/issues/${num}/comments" --paginate \
        --jq --argjson since "$since_epoch" \
        '[.[] | select((.created_at | fromdateiso8601) >= $since)
          | "\(.created_at) @\(.user.login): \((.body // "")[0:100]|gsub("\n";" "))] | .[]' \
        2>/dev/null || true
}

new_discussion_comments() {
    local since_iso="$1"
    "$GH_BIN" api graphql -f query="
      query {
        repository(owner:\"${OWNER}\", name:\"${NAME}\") {
          discussion(number:${DISC}) {
            comments(last:30) {
              nodes { createdAt author { login } body }
            }
          }
        }
      }" --jq --arg since "$since_iso" '
        [.data.repository.discussion.comments.nodes[]?
         | select(.createdAt >= $since)
         | "\(.createdAt) @\(.author.login): \((.body // "")[0:100]|gsub("\n";" "))] | .[]
      ' 2>/dev/null || true
}

pr_status_line() {
    local num="$1"
    "$GH_BIN" pr view "$num" -R "$REPO" \
        --json state,mergeable,mergeStateStatus,labels \
        --jq '"#\(.number // "'"$num"'") \(.state) \(.mergeable)/\(.mergeStateStatus) [\([.labels[].name]|join(","))]"' \
        2>/dev/null || echo "#${num} unreadable"
}

: >"$LOG"
FINDINGS="${LOG}.findings"
: >"$FINDINGS"
START_EPOCH="$(date -u +%s)"
START_ISO="$(ts)"

echo "[$(ts)] start session=$SESSION sweeps=$TOTAL interval=${INTERVAL}s watching disc=#${DISC} issue=#${ISSUE} prs=${PRS[*]}" | tee -a "$LOG"

for ((i = 1; i <= TOTAL; i++)); do
    sweep_ts="$(ts)"
    signals=0
    block=""

    hits="$(new_discussion_comments "$START_ISO" || true)"
    if [[ -n "$hits" ]]; then
        block+="Discussion #${DISC}:"$'\n'"${hits}"$'\n'
        signals=$((signals + $(printf '%s\n' "$hits" | grep -c . || true)))
    fi

    hits="$(new_issue_comments "$ISSUE" "$START_EPOCH" || true)"
    if [[ -n "$hits" ]]; then
        block+="Issue #${ISSUE}:"$'\n'"${hits}"$'\n'
        signals=$((signals + $(printf '%s\n' "$hits" | grep -c . || true)))
    fi

    for pr in "${PRS[@]}"; do
        st="$(pr_status_line "$pr" || true)"
        echo "[$sweep_ts] $st" >>"$LOG"
        case "$st" in
            *CONFLICTING*|*DIRTY*|*CLOSED*|*MERGED*)
                block+="PR status: ${st}"$'\n'
                signals=$((signals + 1))
                ;;
        esac
        hits="$(new_issue_comments "$pr" "$START_EPOCH" || true)"
        if [[ -n "$hits" ]]; then
            block+="PR #${pr} comments:"$'\n'"${hits}"$'\n'
            signals=$((signals + $(printf '%s\n' "$hits" | grep -c . || true)))
        fi
    done

    if [[ "$signals" -eq 0 ]]; then
        detail="sweep ${i}/${TOTAL}: quiet (disc #${DISC}, issue #${ISSUE}, ${#PRS[@]} PRs)"
        echo "[$sweep_ts] $detail" | tee -a "$LOG"
    else
        detail="sweep ${i}/${TOTAL}: ${signals} signal(s) — ${FINDINGS}"
        {
            echo "===== $sweep_ts sweep ${i}/${TOTAL} ====="
            printf '%s\n' "$block"
        } | tee -a "$LOG" | tee -a "$FINDINGS" >/dev/null
        echo "[$sweep_ts] $detail" | tee -a "$LOG"
    fi

    update_job "$i" "$detail"

    if [[ "$i" -lt "$TOTAL" ]]; then
        sleep "$INTERVAL"
    fi
done

echo "[$(ts)] complete — findings: $FINDINGS" | tee -a "$LOG"
exit 0
