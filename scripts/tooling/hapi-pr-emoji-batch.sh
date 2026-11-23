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
# shellcheck source=lib/dogfood-countdown.sh
source "$SCRIPT_DIR/lib/dogfood-countdown.sh"
# shellcheck source=lib/hapi-manifest-path.sh
source "$SCRIPT_DIR/lib/hapi-manifest-path.sh"
# shellcheck source=lib/meta-wave.sh
source "$SCRIPT_DIR/lib/meta-wave.sh"
MERGE_POLICY_JSON="$(pmp_load_policy)"
# shellcheck source=lib/require-gh-version.sh
source "$SCRIPT_DIR/lib/require-gh-version.sh"
require_gh_version

# Wave overlay for MERGED rows (watch-only → 🧹). Cite provenance = repo recipe
# (never HAPI_META_MANIFEST / stale ~/.config mirror). Composition override is
# optional for Gate A layer checks only (#2376 inverse under the dance, 2026-11-20).
HAPI_PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
PROVENANCE_PATH="$(hapi_manifest_provenance_path "$HAPI_PRIMARY")"
COMPOSITION_PATH="${HAPI_META_MANIFEST:-$(hapi_manifest_path "$HAPI_PRIMARY")}"
PROVENANCE_TEXT=""
COMPOSITION_TEXT=""
[[ -f "$PROVENANCE_PATH" ]] && PROVENANCE_TEXT="$(cat "$PROVENANCE_PATH")"
[[ -f "$COMPOSITION_PATH" ]] && COMPOSITION_TEXT="$(cat "$COMPOSITION_PATH")"
[[ -n "$COMPOSITION_TEXT" ]] || COMPOSITION_TEXT="$PROVENANCE_TEXT"

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

# Prints the bot verdict as: "<commit_id-or-'-'>\n<body…>"
# The commit_id is the review's OWN field — no body scraping. A verdict for a
# different commit is not a verdict for this tip (see the staleness gate in
# classify_one): tiann/hapi#945 chipped ✅ "self-merge eligible" off a review of
# a commit 984 behind the tip, and carries bot-skip so no fresh one will come.
# Fork issue-comment reviews carry no commit_id, so they emit "-" (unassessable)
# and the staleness gate stays off for them.
fetch_latest_bot_review() {
    local n="$1" label
    label="$(gh_t pr view "$n" --repo "$REPO" --json labels \
        --jq '[.labels[].name]|contains(["cold-review-clean"])' 2>/dev/null || echo false)"
    if [[ "$label" == "true" ]]; then
        # An attestation names the head it was given to — see
        # pec_attestation_is_stale. If the branch was pushed after the label
        # landed, the label attests a tip that no longer exists, so fall through
        # to the real bot verdict (and its own staleness gate) instead of
        # short-circuiting to clean.
        local crc_at head_at
        crc_at="$(gh_t api "repos/${REPO}/issues/${n}/timeline" --paginate --slurp 2>/dev/null \
            | jq -r 'add | [.[] | select(.event == "labeled" and .label.name == "cold-review-clean")]
                     | last | .created_at // empty' 2>/dev/null || echo "")"
        head_at="$(gh_t api "repos/${REPO}/pulls/${n}/commits" --paginate --slurp 2>/dev/null \
            | jq -r 'add | last | .commit.committer.date // empty' 2>/dev/null || echo "")"
        if pec_attestation_is_stale "$crc_at" "$head_at"; then
            echo "hapi-pr-emoji-batch: #${n} cold-review-clean is STALE (labelled ${crc_at}, head ${head_at}) — not scoring it clean" >&2
        else
            printf '%s\n%s\n' "__LABEL__" "__CLEAN_LABEL__"
            return 0
        fi
    fi
    # IMPORTANT: never use `gh api --paginate --jq '…|last|…'`.
    # With --jq, gh filters EACH page and concatenates string outputs. On long
    # PRs (#1108 had 2+ review pages) that glues an older page's tip body onto
    # the real tip — body-grep then false-[Major] (⚠️) while tip is Findings:None.
    # --slurp cannot combine with --jq (gh 2.96); pipe pages through jq `add`.
    if [[ "$OWNER" == "heavygee" ]]; then
        printf '%s\n' "-"
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
                | ((.commit_id // "-") + "\n" + (.body // ""))' \
            2>/dev/null || printf '%s\n' "-"
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
        head_ref="${17:-}" blocked_up="${18:-0}" \
        related_refs="${19:-}" branch_hints="${20:-}"
    local in_queue=true sticky
    [[ "$exists" == "1" && "$merged" == "0" && "$closed" == "0" && "$data_unavail" == "0" ]] || in_queue=false
    b() { [[ "$1" == "1" ]] && echo true || echo false; }
    sticky="$(pec_default_sticky_ping "$emoji" "$blocked_up")"
    jq -n \
        --arg emoji "$emoji" --arg action "$action" --arg merge "$merge_state" \
        --arg mergeLane "$merge_lane" --arg headRef "$head_ref" \
        --arg relatedRefs "$related_refs" --arg branchHints "$branch_hints" \
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
         + (if ($headRef|length)>0 then {headRef:$headRef} else {} end)
         + (if ($relatedRefs|length)>0 then {relatedRefs:$relatedRefs} else {} end)
         + (if ($branchHints|length)>0 then {branchHints:$branchHints} else {} end)' \
        >"$out"
}

# Gate A helpers: closing-issue / title "(#N)" refs + soup branch tokens from body.
# Used on the MERGED early-return path so wave-clear can attribute issue-cited layers.
_gate_a_related_refs() {
    local n="$1" title="$2"
    local closing title_refs
    closing="$(gh_t pr view "$n" --repo "$REPO" --json closingIssuesReferences \
        --jq '[.closingIssuesReferences[].number] | map(tostring) | join(" ")' 2>/dev/null || echo "")"
    title_refs="$(printf '%s' "$title" | grep -oE '\(#[0-9]+\)' | tr -d '(#)' | tr '\n' ' ')"
    # shellcheck disable=SC2086
    printf '%s\n' $closing $title_refs | sed '/^$/d' | sort -nu | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

_gate_a_branch_hints() {
    local head_ref="$1" body="$2"
    local from_body
    from_body="$(printf '%s' "$body" | grep -oE '(driver|feat|fix|chore|soup)/[A-Za-z0-9._-]+' | sort -u | tr '\n' ' ')"
    # shellcheck disable=SC2086
    printf '%s\n' $head_ref $from_body | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//'
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
    local action
    action="$(pmp_action_for_lane "$lane" "$REPO") (${reason})"
    # dogfooded: surface 48h opt-out countdown on the chip action (Meta queue splits on the phrase).
    if dogfood_has_label "$labs"; then
        local df_status df_secs df_human
        IFS=$'\t' read -r df_status df_secs df_human <<<"$(dogfood_status_for_pr "$REPO" "$n" "$labs")"
        case "$df_status" in
            waiting)
                lane="self_merge"
                action="full green - dogfooded countdown (${df_human} left; merge after window + laneb auth)"
                ;;
            ready)
                lane="self_merge"
                action="full green - self-merge eligible (dogfooded; window elapsed — needs laneb auth)"
                ;;
            unknown)
                lane="self_merge"
                action="full green - dogfooded countdown (stamp unknown — check label events / PR comment)"
                ;;
        esac
    fi
    printf '%s\t%s' "$lane" "$action"
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
# Prints: "<unresolved_count>\t<review_decision_or_dash>\t<head_oid_or_dash>"
# unresolved_count is -1 on transport/parse failure.
# head_oid rides along so the caller can tell a tip-matched bot verdict from a
# stale one without a second round trip (see the staleness gate in classify_one).
# EMPTY FIELDS ARE EMITTED AS "-", never as nothing. Tab is an IFS *whitespace*
# character, so bash `read` collapses runs of tabs and strips leading ones: with
# a null reviewDecision, "0\t\t<oid>" splits into TWO fields and the oid lands
# in review_decision. Caller normalizes "-" back to empty.
# Is the `test` gate already red on the PR's OWN base tip? Then a red head is
# inherited and the branch cannot fix it — see pec_decide_emoji's note on #945.
# Prints 1/0, and 0 on any uncertainty: claiming "inherited" without evidence
# would excuse a genuinely broken PR, which is the costlier direction to be
# wrong in. Only called when the head is actually failing, so the extra API
# call is paid on red PRs rather than on every sweep.
_base_checks_failing() {
    local n="$1" base_oid json
    base_oid="$(gh_t pr view "$n" --repo "$REPO" --json baseRefOid -q .baseRefOid 2>/dev/null || true)"
    [[ "$base_oid" =~ ^[0-9a-f]{40}$ ]] || { echo 0; return; }
    json="$(gh_t api "repos/${REPO}/commits/${base_oid}/check-runs" --paginate 2>/dev/null || true)"
    # External jq -s: `--paginate -q` filters per page, and this gh rejects
    # --slurp alongside --jq (both traps cost a retracted verdict this week).
    if printf '%s' "$json" | jq -s -e '
            [.[].check_runs[]?] | map(select(.name == "test"))
            | length > 0
              and all(.[]; .status == "completed"
                        and .conclusion != "success"
                        and .conclusion != "skipped"
                        and .conclusion != "neutral")
        ' >/dev/null 2>&1; then
        echo 1
    else
        echo 0
    fi
}

_fetch_review_signals() {
    local n="$1"
    local cursor="" page unresolved=0 decision="" head_oid="" has_next=true resp page_n
    while [[ "$has_next" == "true" ]]; do
        if [[ -n "$cursor" ]]; then
            resp="$(gh_t api graphql -f query="
query(\$cursor: String) {
  repository(owner:\"${OWNER}\", name:\"${NAME}\") {
    pullRequest(number: ${n}) {
      reviewDecision
      headRefOid
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
      headRefOid
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated }
      }
    }
  }
}" 2>/dev/null || true)"
        fi
        if ! printf '%s' "$resp" | jq -e '.data.repository.pullRequest' >/dev/null 2>&1; then
            printf '%s\t%s\t%s\n' "-1" "-" "-"
            return
        fi
        decision="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewDecision // empty')"
        head_oid="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.headRefOid // empty')"
        page_n="$(printf '%s' "$resp" | jq -c '.data.repository.pullRequest.reviewThreads.nodes // []' \
            | pec_count_chip_unresolved_threads)"
        if [[ ! "$page_n" =~ ^[0-9]+$ ]]; then
            printf '%s\t%s\t%s\n' "-1" "-" "-"
            return
        fi
        unresolved=$(( unresolved + page_n ))
        has_next="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
        cursor="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')"
        [[ "$has_next" == "true" && -n "$cursor" ]] || has_next=false
    done
    printf '%s\t%s\t%s\n' "$unresolved" "${decision:--}" "${head_oid:--}"
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
    local head_oid="" bot_review="" bot_commit="" bot_stale=0
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
        --jq '[.state, (.merged|tostring), (.mergeable_state // "unknown"), (.head.ref // ""), (.draft|tostring), ([.labels[].name]|join("|")), ((.body // "")|gsub("[\t\n\r]";" ")), ((.title // "")|gsub("[\t\n\r]";" "))] | @tsv' 2>&1)"; then
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
    local head_ref="" draft_flag="" labels_csv="" pr_body="" pr_title=""
    IFS=$'\t' read -r pr_state pr_json merge_state head_ref draft_flag labels_csv pr_body pr_title <<< "$err_out"
    [[ "$pr_json" == "true" ]] && merged=1
    [[ "$pr_state" == "closed" && "$merged" -eq 0 ]] && closed=1
    # GitHub's mergeable_state is a CACHED computation and lags pushes — on
    # 2026-11-09 #238 reported CONFLICTING for 4+ minutes after the push that
    # fixed it, with GitHub's own refs/pull/238/merge still built on the
    # PREVIOUS head. Painting "rebase (merge state dirty)" on that sends a
    # session to rebase a branch that merges fine. Verify with a real local
    # trial merge against a current base before believing it.
    #
    # Fail-closed: only an explicit "merges clean" (exit 0) clears the flag.
    # A real conflict (1) or an undeterminable result (2) keeps it set.
    # `unknown` must be treated as suspect, not as fine. GitHub returns it while
    # recomputing mergeability — which is exactly what happens right after main
    # moves, i.e. the moment a PR is most likely to have just gone dirty. Letting
    # it fall through made this classifier NON-DETERMINISTIC on an unchanging PR:
    # #945 sat continuously CONFLICTING and the hourly sweep alternated
    #   2026-11-16 23:07  ⚠️  #945 — same blocker
    #   2026-11-17 00:07  ✅  #945 — "full green - self-merge eligible"
    # one hour apart, with GitHub's cached mergeable_state the only varying input.
    # The ✅ branch then overlays merge-lane text, so an unmergeable PR was
    # announced as eligible to merge. The fail-closed handling below was already
    # correct — it was simply unreachable for the undeterminable case.
    if [[ "$merge_state" == "dirty" || "$merge_state" == "behind" \
       || "$merge_state" == "unknown" || -z "$merge_state" ]]; then
        merge_bad=1
        local _verdict="$SCRIPT_DIR/hapi-pr-merge-verdict.sh"
        # The rescue MUST trial-merge against the PR's own base repo. The verdict
        # tool defaults to BASE="origin/main" — the FORK's main, which diverges
        # from upstream/main by ~1,674 commits. So for an upstream PR the rescue
        # was conflicting against the wrong base every time, never clearing
        # merge_bad, and the chip then asserted "merge state dirty" on a PR that
        # merges clean (tiann/hapi#2147, 2026-11-21: GitHub cold → UNKNOWN,
        # rescue failed on the wrong base, chip said dirty, three independent
        # sources said clean). Same footgun as passing bare `main` by hand.
        local _vbase="origin/main"
        if [[ "$OWNER" != "heavygee" ]]; then
            # Only use upstream/main if the ref actually exists here; otherwise
            # skip the rescue rather than silently scoring against the wrong base.
            if git -C "$HAPI_PRIMARY" rev-parse --verify --quiet upstream/main >/dev/null 2>&1; then
                _vbase="upstream/main"
            else
                _vbase=""
            fi
        fi
        if [[ -n "$_vbase" && -x "$_verdict" ]] \
           && "$_verdict" --repo "$REPO" --base "$_vbase" --quiet "$n" >/dev/null 2>&1; then
            merge_bad=0
            merge_state="stale-${merge_state}"
        fi
    fi

    if [[ "$merged" -eq 1 ]]; then
        decided="$(pec_decide_emoji 1 1 0 1 0 1 0 1 0 0 0 0)"
        local related_refs branch_hints
        related_refs="$(_gate_a_related_refs "$n" "$pr_title")"
        branch_hints="$(_gate_a_branch_hints "$head_ref" "$pr_body")"
        # Watch-only overlay applied post-parallel (see _apply_merged_watch_overlays)
        # so classify_one does not need to export the whole meta-wave graph.
        _emit_pr_json "$out" "${decided%%$'\t'*}" "${decided#*$'\t'}" 1 1 0 0 0 0 1 0 1 1 0 "MERGED" "" "$head_ref" 0 \
            "$related_refs" "$branch_hints"
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

    local has_crc=0
    if pec_labels_csv_has "$labels_csv" "cold-review-clean"; then
        has_crc=1
    fi

    read -r checks_ok checks_pending checks_seen pr_review_ok < <(_gh_check_signals "$n")
    # Invalid-json / 503 path returns 0 0 0 0 — with CRC, treat as rollup-unavailable not failing CI.
    if [[ "$has_crc" -eq 1 && "$checks_seen" -eq 0 && "$checks_ok" -eq 0 ]]; then
        checks_ok=1
    fi

    IFS=$'\t' read -r threads_n review_decision head_oid < <(_fetch_review_signals "$n")
    [[ "$review_decision" == "-" ]] && review_decision=""
    [[ "$head_oid" == "-" ]] && head_oid=""
    if [[ -z "$threads_n" || ! "$threads_n" =~ ^-?[0-9]+$ ]]; then
        threads_n=-1
    fi
    [[ "$review_decision" == "CHANGES_REQUESTED" ]] && review_changes=1

    bot_review="$(fetch_latest_bot_review "$n")"
    bot_commit="${bot_review%%$'\n'*}"
    if [[ "$bot_review" == *$'\n'* ]]; then
        bot_body="${bot_review#*$'\n'}"
    else
        bot_body=""
    fi
    if [[ "$bot_body" == "__CLEAN_LABEL__" ]]; then
        bot_clean=1
        has_crc=1
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
        # A green pr-review CHECK with no retrievable body is INDETERMINATE, not
        # clean (heavygee/hapi#338, the originally filed shape). The check only
        # says the review job completed; it carries no verdict. And this branch
        # fires for two different reasons that are indistinguishable here — the
        # bot genuinely hasn't reviewed yet, OR fetch_latest_bot_review returned
        # empty on a timeout/503. Scoring the second as clean is absence-of-data
        # read as a passing answer, which is the defect this whole file keeps
        # getting caught by.
        #
        # hapi-pr-merge-gate.sh already fails closed here ("no bot review found
        # — absence is not a clean verdict"), so scoring it clean also left the
        # chip and the gate disagreeing about the same PR. They now agree.
        #
        # Blast radius checked before changing: every PR in the watched set has
        # at least one bot review (2147:86, 2520:30, 2530:12, 945:17, 2544:5,
        # 2526:1, 2529:2), so no live chip moves on this. The explicit operator
        # attestation path (cold-review-clean, tip-fresh) is unaffected.
        :
    fi

    # Staleness gate: a clean verdict for a DIFFERENT commit says nothing about
    # this tip. The review's own commit_id is authoritative — a green pr-review
    # CHECK only means the job completed, not that its verdict was clean, and a
    # verdict on an older head is not evidence about the current one. Operators
    # can still attest a tip explicitly with the cold-review-clean label, which
    # short-circuits above as __CLEAN_LABEL__.
    if [[ "$bot_clean" -eq 1 && "$bot_has_body" -eq 1 \
          && -n "$head_oid" && -n "$bot_commit" \
          && "$bot_commit" != "-" && "$bot_commit" != "__LABEL__" \
          && "$bot_commit" != "$head_oid" ]]; then
        bot_clean=0
        bot_stale=1
    fi

    # Resolved threads + in-flight CI/pr-review: body-grep Majors from the
    # previous review head are sticky noise — do not emit botMajor in the
    # classify JSON (decide also ignores them for emoji). Keep Majors when
    # GitHub formally requested changes.
    if [[ "$checks_pending" -eq 1 && "$threads_n" -eq 0 && "$bot_major" -eq 1 && "$review_changes" -eq 0 ]]; then
        bot_major=0
    fi

    # Only ask about the base when the head is genuinely red and settled —
    # a pending head is "CI running", not anyone's failure to fix.
    local checks_inherited=0
    if [[ "$checks_ok" -eq 0 && "$checks_pending" -eq 0 && "$checks_seen" -eq 1 ]]; then
        checks_inherited="$(_base_checks_failing "$n")"
    fi

    decided="$(pec_decide_emoji 1 0 0 "$checks_ok" "$checks_pending" "$checks_seen" \
        "$threads_n" "$bot_clean" "$bot_major" "$bot_has_body" "$merge_bad" 0 "$review_changes" 0 "$has_crc" "$bot_stale" "$merge_state" "$checks_inherited")"
    emoji="${decided%%$'\t'*}"
    action="${decided#*$'\t'}"
    local merge_lane=""
    if [[ "$emoji" == "✅" ]]; then
        local lane_out
        lane_out="$(_apply_merge_lane "$n" "$action")"
        merge_lane="${lane_out%%$'\t'*}"
        action="${lane_out#*$'\t'}"
    fi

    # Inherited red as the ONLY complaint: keep ⚠️ visible for the operator but
    # stop the peer nag, reusing the blockedUpstream contract (#128) rather than
    # inventing a second suppression path. Exact match against the core lib's
    # own string means a single part and nothing else actionable — if other
    # parts were appended the action carries "; " and this will not fire.
    # #945 (2026-11-23): its peer was nagged to fix upstream's regression and
    # had to refuse; a nag nobody can action is noise that trains peers to
    # discount the chip.
    local blocked_up=0
    if [[ "$emoji" == "⚠️" && "$action" == "$(pec_checks_inherited_action)" ]]; then
        blocked_up=1
    fi

    _emit_pr_json "$out" "$emoji" "$action" 1 0 0 0 0 "$threads_n" \
        "$checks_ok" "$checks_pending" "$checks_seen" "$bot_clean" "$bot_major" "$merge_state" \
        "$merge_lane" "" "$blocked_up"
}

export REPO OWNER NAME TIMEOUT TMPDIR WALL_LIMIT MERGE_POLICY_JSON
# Path-kind helpers (pmp_path_is_*) removed with product_paths lane reject (5d23292bb);
# do not export -f names that are no longer functions — that aborts the whole batch.
export -f classify_one gh_t fetch_latest_bot_review pec_attestation_is_stale _emit_pr_json _apply_merge_lane \
    _gate_a_related_refs _gate_a_branch_hints \
    pec_decide_emoji pec_gate_draft_blocked pec_labels_csv_has \
    pec_blocked_upstream_action pec_blocked_upstream_dep_from_body \
    pec_default_sticky_ping pec_checks_inherited_action \
    pmp_classify pmp_action_for_lane pmp_load_policy \
    dogfood_has_label dogfood_labeled_at dogfood_secs_remaining dogfood_humanize_secs dogfood_status_for_pr \
    pmp_default_policy_json \
    _gh_check_signals _base_checks_failing _fetch_review_signals _bot_body_findings_clean \
    pec_count_chip_unresolved_threads

# After parallel classify: rewrite watch-only MERGED rows to 🧹 so --table matches
# hapi-meta-daily (pec_decide_emoji alone always emits the owned-cleanup brief).
_apply_merged_watch_overlays() {
    [[ -n "$PROVENANCE_TEXT" ]] || return 0
    local n f decided emoji action related hints sticky
    for n in "${PRS[@]}"; do
        f="$TMPDIR/$n.json"
        [[ -f "$f" ]] || continue
        jq -e '.merged == true and .emoji == "🔧"' "$f" >/dev/null 2>&1 || continue
        emoji="$(jq -r '.emoji' "$f")"
        action="$(jq -r '.action' "$f")"
        related="$(jq -r '.relatedRefs // empty' "$f")"
        hints="$(jq -r '.branchHints // empty' "$f")"
        decided="$(mw_overlay_merged_watch_only \
            "$PROVENANCE_TEXT" "" "$n" "$emoji" "$action" "$related" "$hints" \
            "$COMPOSITION_TEXT")"
        emoji="${decided%%$'\t'*}"
        action="${decided#*$'\t'}"
        [[ "$emoji" == "🧹" ]] || continue
        sticky="$(pec_default_sticky_ping "$emoji" "false")"
        jq -c --arg e "$emoji" --arg a "$action" --argjson s "$sticky" \
            '.emoji=$e | .action=$a | .stickyPing=$s' "$f" >"$f.tmp" \
            && mv "$f.tmp" "$f"
    done
}

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

_apply_merged_watch_overlays

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
