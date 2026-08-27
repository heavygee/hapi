#!/usr/bin/env bash
# hapi-meta-daily — one deterministic morning command for the Meta PR watcher.
#
# WHAT IT DOES (idempotent, safe by default):
#   1. Discovers the union of: open heavygee PRs on tiann/hapi, recently-merged
#      tracked PRs, and every PR-tagged HAPI session on the local hub.
#   2. Classifies each PR ONCE (hapi-pr-emoji-batch.sh → pr-emoji-core).
#   3. Renames stale session titles to the correct emoji.
#   4. Pings a session ONLY when policy says it is actionable and not noise
#      (transition, changed ⚠️/🔧 instruction, or a due reminder) — state-gated
#      so a second run the same morning is a no-op.
#   5. Reads GitHub notifications for tiann/hapi + heavygee/hapi since a stored
#      cursor and folds new human comms into the action queue. Never marks read.
#   6. Prints a sorted operator ACTION QUEUE (⚠️ / 🔧 wave / orphans / inactive /
#      new comms) plus the non-automated next steps (sync, rematerialize).
#
# WHAT IT WILL NEVER DO (judgment / destructive / wave-scoped — surfaced only):
#   merge upstream PRs · sync/push fork main · edit the soup manifest ·
#   rebuild/restart the driver · delete branches/worktrees · archive sessions ·
#   reply on GitHub · mark notifications read.
#
# Usage:
#   hapi-meta-daily.sh                 # classify, rename, policy-ping, queue
#   hapi-meta-daily.sh --dry-run       # decide + print, no hub/state writes
#   hapi-meta-daily.sh --no-ping       # rename + queue, never ping
#   hapi-meta-daily.sh --emit-events   # also POST channel SystemEvents (default OFF)
#   hapi-meta-daily.sh --dry-run --emit-events  # print event bodies, zero HTTP writes
#   hapi-meta-daily.sh --json          # machine-readable plan to stdout
#   hapi-meta-daily.sh --since 2026-07-01   # notification lookback override
#   hapi-meta-daily.sh --reminder-hours 12  # sticky ⚠️/🔧 nag interval
#   hapi-meta-daily.sh --verbose
#
# Prefers the fork mirror (~/coding/hapi); when souped into driver/ the
# low-level batch/ping tools are resolved from $HAPI_PRIMARY (see below).
#
# Env / injection (for tests):
#   HAPI_HOST, HAPI_SETTINGS, HAPI_PR_REPO (default tiann/hapi), HAPI_FORK_REPO
#   HAPI_META_STATE   (default ${XDG_STATE_HOME:-~/.local/state}/hapi/meta-daily.json)
#   HAPI_META_GH_BIN  (default gh)     HAPI_META_CURL_BIN (default curl)
#   HAPI_PRIMARY        (default ~/coding/hapi) — canonical tool fallback root
#   HAPI_META_BATCH_BIN (explicit override; else same-dir, else $HAPI_PRIMARY)
#   HAPI_META_PING_BIN  (explicit override; else same-dir, else $HAPI_PRIMARY)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/pr-emoji-core.sh
source "$SCRIPT_DIR/lib/pr-emoji-core.sh"

UPSTREAM_REPO="${HAPI_PR_REPO:-tiann/hapi}"
FORK_REPO="${HAPI_FORK_REPO:-heavygee/hapi}"
HAPI_HOST="${HAPI_HOST:-http://localhost:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
STATE_FILE="${HAPI_META_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi/meta-daily.json}"
GH_BIN="${HAPI_META_GH_BIN:-gh}"
CURL_BIN="${HAPI_META_CURL_BIN:-curl}"
# Low-level tools live beside this script in the mirror, but soup/driver
# packaging does not copy them. Resolve robustly: explicit env > same-dir >
# canonical $HAPI_PRIMARY/scripts/tooling. See pec_resolve_tool.
HAPI_PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
BATCH_BIN="$(pec_resolve_tool "$SCRIPT_DIR" "$HAPI_PRIMARY" "${HAPI_META_BATCH_BIN:-}" hapi-pr-emoji-batch.sh)"
PING_BIN="$(pec_resolve_tool "$SCRIPT_DIR" "$HAPI_PRIMARY" "${HAPI_META_PING_BIN:-}" hapi-ping-peer.sh)"

export GH_FORCE_TTY=0 GIT_TERMINAL_PROMPT=0 GH_PAGER=cat PAGER=cat

DRY_RUN=0
DO_PING=1
EMIT_EVENTS=0
JSON_OUT=0
VERBOSE=0
SINCE_OVERRIDE=""
REMINDER_SECS=$((24 * 3600))
PR_ONLY=""

err() { echo "hapi-meta-daily: $*" >&2; }
die() { err "$*"; exit 2; }
vlog() { [[ "$VERBOSE" -eq 1 ]] && echo "  · $*" >&2 || true; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --no-ping) DO_PING=0; shift ;;
        --emit-events) EMIT_EVENTS=1; shift ;;
        --json) JSON_OUT=1; shift ;;
        --verbose|-v) VERBOSE=1; shift ;;
        --since) SINCE_OVERRIDE="$2"; shift 2 ;;
        --reminder-hours) REMINDER_SECS=$(( ${2} * 3600 )); shift 2 ;;
        --pr) PR_ONLY="$2"; shift 2 ;;
        --help|-h) sed -n '2,50p' "$0"; exit 0 ;;
        *) die "unknown arg: $1 (try --help)" ;;
    esac
done

# ---------------------------------------------------------------------------
# State (pure-ish: file I/O only, no network)
# ---------------------------------------------------------------------------

md_state_default() {
    jq -cn --arg up "$UPSTREAM_REPO" --arg fork "$FORK_REPO" \
        '{schema:1,last_run:null,notif_cursor:{($up):null,($fork):null},sessions:{},orphan_prs:{},notif_seen:{}}'
}

md_load_state() {
    if [[ -f "$STATE_FILE" ]]; then
        jq -c '.' "$STATE_FILE" 2>/dev/null || md_state_default
    else
        md_state_default
    fi
}

# md_save_state <json> — atomic; caller must skip on dry-run.
md_save_state() {
    local json="$1" dir tmp
    dir="$(dirname "$STATE_FILE")"
    mkdir -p "$dir"
    tmp="$(mktemp "$dir/.meta-daily.XXXXXX")"
    printf '%s' "$json" | jq '.' >"$tmp" && mv -f "$tmp" "$STATE_FILE"
}

md_prev() {  # md_prev <state_json> <sid> <field>
    printf '%s' "$1" | jq -r --arg s "$2" --arg f "$3" '.sessions[$s][$f] // ""'
}

md_now() { date -u +%s; }

# ---------------------------------------------------------------------------
# Hub I/O
# ---------------------------------------------------------------------------

hub_jwt() {
    [[ -f "$SETTINGS" ]] || die "settings not found: $SETTINGS"
    local raw jwt
    raw="$(jq -r '.cliApiToken // empty' "$SETTINGS")"
    [[ -n "$raw" ]] || die "no cliApiToken in $SETTINGS"
    jwt="$("$CURL_BIN" -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg t "$raw:default" '{accessToken:$t}')" \
        "$HAPI_HOST/api/auth" | jq -r '.token // empty')"
    [[ -n "$jwt" ]] || die "JWT exchange failed ($HAPI_HOST reachable?)"
    echo "$jwt"
}

hub_sessions() {  # <jwt> → sessions array json
    "$CURL_BIN" -sS --max-time 15 -H "Authorization: Bearer $1" \
        "$HAPI_HOST/api/sessions?limit=500" | jq -c '.sessions // .'
}

hub_rename() {  # <jwt> <sid> <title>
    [[ "$DRY_RUN" -eq 1 ]] && { echo "    [dry-run] rename → \"$3\"" >&2; return 0; }
    "$CURL_BIN" -sS --max-time 10 -X PATCH -H "Authorization: Bearer $1" \
        -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg n "$3" '{name:$n}')" \
        "$HAPI_HOST/api/sessions/$2" | jq -e '.ok == true' >/dev/null \
        || err "rename failed for ${2:0:8}"
}

# hub_emit_event <jwt> <body-json> — POST channel SystemEvent; dry-run prints only.
# Returns 0 on dry-run / success body with event.id; nonzero on transport or rejection.
hub_emit_event() {
    local jwt="$1" body="$2"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] emit-events body:" >&2
        printf '%s\n' "$body" | jq . >&2
        return 0
    fi
    local resp
    resp="$("$CURL_BIN" -sS --max-time 10 -X POST \
        -H "Authorization: Bearer $jwt" \
        -H 'Content-Type: application/json' \
        -d "$body" \
        "$HAPI_HOST/api/system-events")" || {
        err "emit-events POST failed (transport)"
        return 1
    }
    if ! printf '%s' "$resp" | jq -e '.event.id' >/dev/null 2>&1; then
        err "emit-events POST rejected: $(printf '%s' "$resp" | jq -c '.' 2>/dev/null || echo "$resp")"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# GitHub discovery + notifications
# ---------------------------------------------------------------------------

gh_open_pr_numbers() {
    "$GH_BIN" pr list --repo "$UPSTREAM_REPO" --author "@me" --state open \
        --limit 100 --json number --jq '.[].number' 2>/dev/null || true
}

gh_merged_recent() {  # <since-date> → "number\ttitle\tmergedAt" lines
    "$GH_BIN" pr list --repo "$UPSTREAM_REPO" --author "@me" --state merged \
        --search "merged:>=$1" --limit 100 \
        --json number,title,mergedAt \
        --jq '.[] | [.number, .title, .mergedAt] | @tsv' 2>/dev/null || true
}

# gh_notifications <repo> <since-iso> → "updatedAt\ttype\treason\ttitle\turl" lines,
# CI-only subjects filtered out. Read-only; never marks read.
gh_notifications() {
    local repo="$1" since="$2"
    # all=true → deterministic digest of everything updated since the cursor,
    # independent of the operator's read-state (unread-only drifts run-to-run).
    # since MUST be a URL query param — `gh api -f since=` flips the verb to POST
    # (→404). Drop pure CI (CheckSuite / ci_activity) noise.
    local path="repos/$repo/notifications?all=true"
    [[ -n "$since" ]] && path="${path}&since=${since}"
    # Default digest keeps only human-actionable reasons; --verbose shows all
    # (author/subscribed are mostly your own thread activity).
    local reason_filter='(.reason | IN("comment","mention","review_requested","assign","team_mention","state_change","manual","security_alert"))'
    [[ "$VERBOSE" -eq 1 ]] && reason_filter='true'
    "$GH_BIN" api "$path" --paginate \
        --jq ".[] | select(.subject.type != \"CheckSuite\" and .reason != \"ci_activity\" and $reason_filter)
              | [.updated_at, .subject.type, .reason, .subject.title, (.subject.url // \"\")] | @tsv" \
        2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Pure planning helpers (unit-tested via source)
# ---------------------------------------------------------------------------

# md_session_prs <title> → space-joined PR numbers (dedup order preserved)
md_session_prs() {
    pec_extract_pr_numbers "$1" | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/ *$//'
}

# md_combined_emoji <emoji1> [emoji2...] → worst
md_combined_emoji() {
    local combined="" e
    for e in "$@"; do
        [[ -z "$e" ]] && continue
        if [[ -z "$combined" ]]; then combined="$e"; else combined="$(pec_worst_emoji "$combined" "$e")"; fi
    done
    printf '%s' "$combined"
}

# md_plan_ping <new_emoji> <new_fp> <prev_emoji> <prev_fp> <prev_ping> <now> <reminder>
#   → "yes"/"no" (wraps pec_should_ping; kept for test clarity)
md_plan_ping() {
    pec_should_ping "$1" "$3" "$2" "$4" "${5:-0}" "$6" "$7"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    local now; now="$(md_now)"
    local since_default; since_default="$(date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -u +%Y-%m-%d)"
    local merged_since="${SINCE_OVERRIDE:-$since_default}"

    local state; state="$(md_load_state)"
    # First run has no cursor — bound the notification lookback so we don't dump
    # the entire unread backlog. Default: 7 days ago (same window as merged scan).
    local since_iso_default; since_iso_default="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
    local notif_since_up notif_since_fork
    notif_since_up="$(printf '%s' "$state" | jq -r --arg r "$UPSTREAM_REPO" '.notif_cursor[$r] // ""')"
    notif_since_fork="$(printf '%s' "$state" | jq -r --arg r "$FORK_REPO" '.notif_cursor[$r] // ""')"
    [[ -z "$notif_since_up" || "$notif_since_up" == "null" ]] && notif_since_up="$since_iso_default"
    [[ -z "$notif_since_fork" || "$notif_since_fork" == "null" ]] && notif_since_fork="$since_iso_default"
    [[ -n "$SINCE_OVERRIDE" ]] && { notif_since_up="${SINCE_OVERRIDE}T00:00:00Z"; notif_since_fork="$notif_since_up"; }

    [[ "$JSON_OUT" -eq 0 ]] && echo "hapi-meta-daily: $UPSTREAM_REPO — $(date -u +%Y-%m-%dT%H:%M:%SZ)$([[ $DRY_RUN -eq 1 ]] && echo ' [DRY-RUN]')"

    local jwt sessions_json
    jwt="$(hub_jwt)"
    sessions_json="$(hub_sessions "$jwt")"

    # --- discovery: PR numbers from sessions + open + merged ---
    declare -A SESS_ID SESS_ACTIVE SESS_NAME SESS_PRS
    declare -A PR_SESSIONS      # pr -> "sid8,sid8"
    declare -A ALL_PR           # pr -> 1
    declare -A MERGED_TITLE

    local row sid sid8 active name prs
    while IFS=$'\t' read -r sid active name; do
        [[ -z "$sid" ]] && continue
        [[ "$name" =~ [Yy][Aa][Aa][Cc][Cc] ]] && continue
        prs="$(md_session_prs "$name")"
        [[ -z "$prs" ]] && continue
        sid8="${sid:0:8}"
        SESS_ID["$sid8"]="$sid"
        SESS_ACTIVE["$sid8"]="$active"
        SESS_NAME["$sid8"]="$name"
        SESS_PRS["$sid8"]="$prs"
        local p
        for p in $prs; do
            ALL_PR["$p"]=1
            PR_SESSIONS["$p"]="${PR_SESSIONS[$p]:+${PR_SESSIONS[$p]},}$sid8"
        done
    done < <(printf '%s' "$sessions_json" | jq -r '
        .[] | select((.metadata.name // "") | test("Peer #[0-9]{3,4}|PR #[0-9]{3,4}|pr#[0-9]{3,4}|#[0-9]{3,4}"; "i"))
            | "\(.id)\t\(.active // false)\t\(.metadata.name // "")"')

    if [[ -n "$PR_ONLY" ]]; then
        # Restrict to a single explicit PR (allows low-numbered upstream PRs).
        ALL_PR=(["$PR_ONLY"]=1)
    else
        local p
        for p in $(gh_open_pr_numbers); do ALL_PR["$p"]=1; done
        while IFS=$'\t' read -r num title _mergedAt; do
            [[ -z "$num" ]] && continue
            ALL_PR["$num"]=1
            MERGED_TITLE["$num"]="$title"
        done < <(gh_merged_recent "$merged_since")
    fi

    local pr_list=()
    for p in "${!ALL_PR[@]}"; do pr_list+=("$p"); done
    [[ ${#pr_list[@]} -gt 0 ]] || { echo "No tracked PRs / PR-tagged sessions found."; return 0; }
    IFS=$'\n' pr_list=($(sort -n <<<"${pr_list[*]}")); unset IFS

    vlog "classifying ${#pr_list[@]} PR(s): ${pr_list[*]}"
    local batch_json
    batch_json="$(HAPI_PR_REPO="$UPSTREAM_REPO" "$BATCH_BIN" --repo "$UPSTREAM_REPO" "${pr_list[@]}")" \
        || die "batch classify failed"

    declare -A PR_EMOJI PR_ACTION PR_PREPR
    for p in "${pr_list[@]}"; do
        PR_EMOJI["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].emoji // "?"')"
        PR_ACTION["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].action // ""')"
        PR_PREPR["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].prePr // false')"
    done

    # --- per-session: rename + policy ping; build next state ---
    local new_state="$state"
    local -a Q_WARN Q_MERGED Q_ORPHAN Q_INACTIVE Q_PINGED Q_RENAMED
    local -a PLAN_ROWS   # for --json
    MD_EMIT_FAILURES=0

    local sid8
    for sid8 in "${!SESS_ID[@]}"; do
        sid="${SESS_ID[$sid8]}"
        name="${SESS_NAME[$sid8]}"
        active="${SESS_ACTIVE[$sid8]}"
        prs="${SESS_PRS[$sid8]}"
        local emojis=() acts="" combined pre=0 first_pr=""
        for p in $prs; do
            emojis+=("${PR_EMOJI[$p]}")
            [[ -z "$first_pr" ]] && first_pr="$p"
            local a="${PR_ACTION[$p]}"
            [[ -n "$a" ]] && acts+="#$p: $a"$'\n'
        done
        combined="$(md_combined_emoji "${emojis[@]}")"
        [[ -z "$combined" ]] && combined="?"

        # desired title
        local new_title
        if [[ "$(printf '%s' "$prs" | wc -w)" -eq 1 ]]; then
            [[ "${PR_PREPR[$first_pr]}" == "true" ]] && pre=1
            new_title="$(pec_build_title "$combined" "$first_pr" "$name" "$pre")"
        else
            local p2; p2="$(printf '%s' "$prs" | awk '{print $2}')"
            new_title="${combined}PR #${first_pr}/#${p2}: $(pec_title_base_multi_from "$name" "$first_pr" "$p2")"
        fi

        # rename (skip on "?")
        if [[ "$(pec_should_rename "$new_title" "$name" "$combined")" == "yes" ]]; then
            hub_rename "$jwt" "$sid" "$new_title"
            Q_RENAMED+=("$sid8  $name  →  $new_title")
        fi

        # ping policy (actuator cursor: emoji/fp/last_ping)
        local action_fp prev_emoji prev_fp prev_ping decision
        action_fp="$(pec_action_fingerprint "$combined" "$acts")"
        prev_emoji="$(md_prev "$state" "$sid" "emoji")"
        prev_fp="$(md_prev "$state" "$sid" "fp")"
        prev_ping="$(md_prev "$state" "$sid" "last_ping")"
        [[ -z "$prev_ping" ]] && prev_ping=0
        # md_plan_ping/pec_should_ping return 1 for "no"; capture text, ignore rc.
        decision="$(md_plan_ping "$combined" "$action_fp" "$prev_emoji" "$prev_fp" "$prev_ping" "$now" "$REMINDER_SECS" || true)"

        local this_ping="$prev_ping"
        if [[ "$combined" == "?" ]]; then
            : # unknown: leave everything, don't touch state emoji
        else
            if [[ "$decision" == "yes" && "$DO_PING" -eq 1 ]]; then
                if [[ "$active" == "true" ]]; then
                    _do_ping "$sid8" "$combined" "$prs" "$acts"
                    Q_PINGED+=("$sid8  $combined  #$(echo "$prs" | tr ' ' ',')")
                    this_ping="$now"
                elif [[ "$combined" == "⚠️" || "$combined" == "🔧" ]]; then
                    # Only nag about asleep sessions that actually need action.
                    Q_INACTIVE+=("$sid8  $combined  #$(echo "$prs" | tr ' ' ',')  — inactive; run: hapi-ping-peer $sid8 \"…\"")
                fi
            fi

            # Channel emit uses a separate emitted_* cursor so a failed POST
            # remains retryable even when rename/ping state advances.
            if [[ "$EMIT_EVENTS" -eq 1 ]]; then
                local emit_reason prev_emitted_e prev_emitted_fp prev_emitted_at
                prev_emitted_e="$(md_prev "$state" "$sid" "emitted_emoji")"
                prev_emitted_fp="$(md_prev "$state" "$sid" "emitted_fp")"
                prev_emitted_at="$(md_prev "$state" "$sid" "last_emitted")"
                [[ -z "$prev_emitted_at" ]] && prev_emitted_at=0
                emit_reason="$(pec_emit_reason "$combined" "$prev_emitted_e" "$action_fp" "$prev_emitted_fp" "$prev_emitted_at" "$now" "$REMINDER_SECS" || true)"
                if [[ "$emit_reason" != "none" && -n "$emit_reason" ]]; then
                    local emit_date emit_pr emit_body
                    emit_date="$(date -u +%Y-%m-%d)"
                    emit_pr="${first_pr}"
                    emit_body="$(pec_build_channel_event_body \
                        --repo "$UPSTREAM_REPO" \
                        --number "$emit_pr" \
                        --emoji "$combined" \
                        --action "$(echo "$acts" | head -1 | sed 's/^#[0-9]*: //')" \
                        --fingerprint "$action_fp" \
                        --session-id "$sid" \
                        --reason "$emit_reason" \
                        --date "$emit_date")"
                    if hub_emit_event "$jwt" "$emit_body"; then
                        new_state="$(printf '%s' "$new_state" | jq -c \
                            --arg s "$sid" --arg e "$combined" --arg f "$action_fp" --argjson le "$now" \
                            '.sessions[$s] = ((.sessions[$s] // {}) + {emitted_emoji:$e, emitted_fp:$f, last_emitted:$le})')"
                        vlog "emit-events $sid8 $combined reason=$emit_reason"
                    else
                        MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
                    fi
                fi
            fi

            # Actuator state always advances independently of emit success.
            new_state="$(printf '%s' "$new_state" | jq -c \
                --arg s "$sid" --arg e "$combined" --arg f "$action_fp" \
                --argjson lp "${this_ping:-0}" --arg t "$new_title" \
                '.sessions[$s] = ((.sessions[$s] // {}) + {emoji:$e, fp:$f, last_ping:$lp, title:$t})')"
        fi

        # action queue rows
        case "$combined" in
            ⚠️) Q_WARN+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')") ;;
            🔧) Q_MERGED+=("#$(echo "$prs" | tr ' ' ',') [$sid8] MERGED — peer: drop soup layer, clean worktree/branch, ack") ;;
        esac

        PLAN_ROWS+=("$(jq -cn --arg sid "$sid8" --arg emoji "$combined" --arg prs "$prs" \
            --arg ping "$decision" --arg renamed "$([[ ${Q_RENAMED[*]:-} == *"$sid8"* ]] && echo yes || echo no)" \
            '{sid:$sid,emoji:$emoji,prs:$prs,ping:$ping}')")
    done

    # --- orphan PRs (tracked/open/merged but no session) ---
    for p in "${pr_list[@]}"; do
        [[ -n "${PR_SESSIONS[$p]:-}" ]] && continue
        local e="${PR_EMOJI[$p]}"
        case "$e" in
            🔧) Q_ORPHAN+=("#$p 🔧 merged, no owning session — confirm wave cleanup done / archive") ;;
            📝|"?") : ;;
            *) Q_ORPHAN+=("#$p $e open, NO HAPI session — assign an owner or spawn a peer") ;;
        esac
        # Orphan ⚠️ emits needs_decision with null relatedSessionId (inbox stays quiet).
        # State-gated like sessions so steady re-runs stay silent.
        if [[ "$EMIT_EVENTS" -eq 1 && "$e" == "⚠️" ]]; then
            local orphan_fp orphan_prev_e orphan_prev_fp orphan_reason orphan_body orphan_date
            orphan_date="$(date -u +%Y-%m-%d)"
            orphan_fp="$(pec_action_fingerprint "$e" "${PR_ACTION[$p]}")"
            orphan_prev_e="$(printf '%s' "$state" | jq -r --arg p "$p" '(.orphan_prs // {})[$p].emoji // ""')"
            orphan_prev_fp="$(printf '%s' "$state" | jq -r --arg p "$p" '(.orphan_prs // {})[$p].fp // ""')"
            orphan_reason="$(pec_emit_reason "$e" "$orphan_prev_e" "$orphan_fp" "$orphan_prev_fp" 0 "$now" "$REMINDER_SECS" || true)"
            if [[ "$orphan_reason" != "none" && -n "$orphan_reason" ]]; then
                orphan_body="$(pec_build_channel_event_body \
                    --repo "$UPSTREAM_REPO" \
                    --number "$p" \
                    --emoji "$e" \
                    --action "${PR_ACTION[$p]}" \
                    --fingerprint "$orphan_fp" \
                    --session-id "" \
                    --reason "$orphan_reason" \
                    --date "$orphan_date")"
                if hub_emit_event "$jwt" "$orphan_body"; then
                    new_state="$(printf '%s' "$new_state" | jq -c \
                        --arg p "$p" --arg e "$e" --arg f "$orphan_fp" \
                        '.orphan_prs = ((.orphan_prs // {}) + {($p): {emoji:$e, fp:$f}})')"
                else
                    MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
                fi
            fi
        fi
    done

    # --- notifications (new human comms) ---
    local -a Q_NOTIF
    local nsince_up_new="$notif_since_up" nsince_fork_new="$notif_since_fork"
    local MD_NOTIF_EMIT_FAIL_UP=0 MD_NOTIF_EMIT_FAIL_FORK=0
    while IFS=$'\t' read -r uAt typ reason title url; do
        [[ -z "$uAt" ]] && continue
        Q_NOTIF+=("$UPSTREAM_REPO  $typ/$reason  $title")
        [[ "$uAt" > "$nsince_up_new" ]] && nsince_up_new="$uAt"
        if [[ "$EMIT_EVENTS" -eq 1 ]]; then
            if ! _emit_notif_event "$jwt" "$UPSTREAM_REPO" "$title" "$url" "$typ" "$reason" "$uAt"; then
                MD_NOTIF_EMIT_FAIL_UP=$((MD_NOTIF_EMIT_FAIL_UP + 1))
            fi
        fi
    done < <(gh_notifications "$UPSTREAM_REPO" "$notif_since_up")
    while IFS=$'\t' read -r uAt typ reason title url; do
        [[ -z "$uAt" ]] && continue
        Q_NOTIF+=("$FORK_REPO  $typ/$reason  $title")
        [[ "$uAt" > "$nsince_fork_new" ]] && nsince_fork_new="$uAt"
        if [[ "$EMIT_EVENTS" -eq 1 ]]; then
            if ! _emit_notif_event "$jwt" "$FORK_REPO" "$title" "$url" "$typ" "$reason" "$uAt"; then
                MD_NOTIF_EMIT_FAIL_FORK=$((MD_NOTIF_EMIT_FAIL_FORK + 1))
            fi
        fi
    done < <(gh_notifications "$FORK_REPO" "$notif_since_fork")

    # Advance GitHub notif cursor only when this run's notif emits succeeded
    # (or --emit-events is off). A failed notif POST must leave the cursor so
    # the next since= query still returns that notification.
    local now_iso cursor_up cursor_fork
    now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cursor_up="$now_iso"
    cursor_fork="$now_iso"
    if [[ "$EMIT_EVENTS" -eq 1 && "$MD_NOTIF_EMIT_FAIL_UP" -gt 0 ]]; then
        cursor_up="$notif_since_up"
        vlog "notif_cursor[$UPSTREAM_REPO] frozen after emit failure (was since=$notif_since_up)"
    fi
    if [[ "$EMIT_EVENTS" -eq 1 && "$MD_NOTIF_EMIT_FAIL_FORK" -gt 0 ]]; then
        cursor_fork="$notif_since_fork"
        vlog "notif_cursor[$FORK_REPO] frozen after emit failure (was since=$notif_since_fork)"
    fi
    new_state="$(printf '%s' "$new_state" | jq -c \
        --arg r1 "$UPSTREAM_REPO" --arg r2 "$FORK_REPO" \
        --arg cu "$cursor_up" --arg cf "$cursor_fork" --arg t "$now_iso" \
        '.notif_cursor[$r1]=$cu | .notif_cursor[$r2]=$cf | .last_run=$t')"

    if [[ "$JSON_OUT" -eq 1 ]]; then
        local plan_json="[]"
        if [[ ${#PLAN_ROWS[@]} -gt 0 ]]; then
            plan_json="$(printf '%s\n' "${PLAN_ROWS[@]}" | jq -s '.')"
        fi
        printf '%s\n' "$new_state" | jq --argjson plan "$plan_json" '. + {plan:$plan}'
    else
        _print_queue
    fi

    # persist only on a completed, non-dry run
    if [[ "$DRY_RUN" -eq 0 ]]; then
        md_save_state "$new_state"
        vlog "state saved → $STATE_FILE"
    elif [[ "$JSON_OUT" -eq 0 ]]; then
        echo ""
        echo "  [dry-run] state NOT written; no renames/pings performed"
    fi

    if [[ "$EMIT_EVENTS" -eq 1 && "$MD_EMIT_FAILURES" -gt 0 ]]; then
        err "emit-events: $MD_EMIT_FAILURES POST(s) failed — emit cursor not advanced for those; will retry next run"
        return 1
    fi
    return 0
}

# _emit_notif_event <jwt> <repo> <title> <url> <type> <reason> <updatedAt>
# Emits needs_decision bound to a matching session when the notif title carries a PR#.
# Deduped via state.notif_seen[key] so steady re-runs stay silent even if gh mock
# ignores the since cursor.
_emit_notif_event() {
    local jwt="$1" repo="$2" title="$3" url="$4" typ="$5" reason="$6" uAt="$7"
    local pr sid8 sid body fp date seen_key
    pr="$(printf '%s' "$title" | grep -oE '#[0-9]{3,4}' | head -1 | tr -d '#' || true)"
    [[ -n "$pr" ]] || return 0
    seen_key="${repo}|${uAt}|${typ}|${reason}|${title}"
    if printf '%s' "$new_state" | jq -e --arg k "$seen_key" '((.notif_seen // {})[$k]) == true' >/dev/null 2>&1; then
        return 0
    fi
    # Also skip if already recorded in loaded state from a prior run.
    if printf '%s' "$state" | jq -e --arg k "$seen_key" '((.notif_seen // {})[$k]) == true' >/dev/null 2>&1; then
        return 0
    fi
    sid8="${PR_SESSIONS[$pr]:-}"
    sid8="${sid8%%,*}"
    sid=""
    [[ -n "$sid8" ]] && sid="${SESS_ID[$sid8]:-}"
    date="$(date -u +%Y-%m-%d)"
    fp="$(pec_action_fingerprint "notif" "${typ}/${reason}/${title}/${uAt}")"
    body="$(pec_build_channel_event_body \
        --repo "$repo" \
        --number "$pr" \
        --emoji "⚠️" \
        --action "GitHub ${typ}/${reason}: ${title}" \
        --fingerprint "$fp" \
        --session-id "$sid" \
        --reason transition \
        --date "$date" \
        --notif \
        --title "$title" \
        --url "${url:-https://github.com/${repo}/pull/${pr}}")"
    hub_emit_event "$jwt" "$body" || {
        MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
        return 1
    }
    new_state="$(printf '%s' "$new_state" | jq -c --arg k "$seen_key" \
        '.notif_seen = ((.notif_seen // {}) + {($k): true})')"
}

_do_ping() {  # <sid8> <emoji> <prs> <acts>
    local sid8="$1" emoji="$2" prs="$3" acts="$4"
    local state_desc
    case "$emoji" in
        ✅) state_desc="open PR green — wait on tiann" ;;
        🔁) state_desc="CI/rebase in flight" ;;
        ⚠️) state_desc="needs work" ;;
        📝) state_desc="pre-PR — not filed upstream yet" ;;
        🔧) state_desc="MERGED — clean up, idle (no mid-turn self-archive)" ;;
        *) state_desc="see title" ;;
    esac
    local msg="Meta daily — session is now **${emoji}** (${state_desc}).

Tracked PR(s): #$(echo "$prs" | tr ' ' ',')

${acts}
Legend: ✅ green/wait · 🔁 CI in flight · ⚠️ fix threads/CI/rebase · 📝 pre-PR · 🔧 merged (drop soup layer, clean worktree/branch, ack; no mid-turn self-archive).
Canon: docs/operator/AGENTS.md § Meta PR watcher"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] ping $sid8 ($emoji)" >&2
        return 0
    fi
    "$PING_BIN" "$sid8" "$msg" >/dev/null 2>&1 || err "ping failed for $sid8"
}

_print_section() {  # <title> <array-name>
    local title="$1"; shift
    local -a items=("$@")
    [[ ${#items[@]} -eq 0 ]] && return 0
    echo ""
    echo "$title"
    local it
    for it in "${items[@]}"; do
        [[ -z "$it" ]] && continue
        echo "  - $it"
    done
}

_print_queue() {
    _print_section "⚠️  NEEDS WORK (yours to unblock / direct the peer):" "${Q_WARN[@]:-}"
    _print_section "🔧  MERGED — advise wave cleanup:" "${Q_MERGED[@]:-}"
    _print_section "❓ ORPHANS (PR without a matching session):" "${Q_ORPHAN[@]:-}"
    _print_section "😴 INACTIVE (policy wanted a ping; session asleep):" "${Q_INACTIVE[@]:-}"
    _print_section "📨 NEW GITHUB COMMS since last run:" "${Q_NOTIF[@]:-}"
    _print_section "✅ RENAMED this run:" "${Q_RENAMED[@]:-}"
    _print_section "📣 PINGED this run:" "${Q_PINGED[@]:-}"
    echo ""
    echo "NEXT STEPS (NOT automated — operator/meta judgment):"
    echo "  - Merges are @tiann's call. Never 'gh pr merge' on tiann/hapi."
    echo "  - After a 🔧 wave is fully acked: hapi-sync-fork-main && git push origin main,"
    echo "    then meta rematerializes soup ONCE (hapi-driver-rebuild --build-web --verify)."
    echo "  - Archive idle 🔧 sessions from outside once soup is fresh."
}

# Only run main when executed, not when sourced by the test.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
    exit $?
fi
