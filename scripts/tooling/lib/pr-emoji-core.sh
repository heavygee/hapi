#!/usr/bin/env bash
# pr-emoji-core — pure functions for HAPI PR-watcher emoji classification, title
# rewriting, and ping policy. NO network, NO hub, NO gh: everything here takes
# explicit inputs so it can be unit-tested (scripts/tooling/lib/pr-emoji-core.test.sh).
#
# Sourced by:
#   scripts/tooling/hapi-pr-emoji-batch.sh    (gh I/O → calls pec_decide_emoji)
#   scripts/tooling/hapi-pr-session-emoji.sh  (hub I/O → titles + worst-emoji)
#   scripts/tooling/hapi-meta-daily.sh         (orchestrator → ping policy + state)
#
# Emoji contract (see docs/operator/AGENTS.md § Meta PR watcher):
#   ✅  open PR, CI green, 0 threads, bot clean, mergeable — wait on tiann
#   🔁  CI/bot in flight, or thread/CI data momentarily unavailable — retry
#   ⚠️  needs work — failing CI, open threads, bot findings, rebase, or closed-unmerged
#   📝  pre-PR — tracked number, no open PR on upstream yet
#   🔧  merged — clean up soup/worktree, idle (no mid-turn self-archive)
#   ?   UNKNOWN — GitHub data unavailable this run; caller MUST NOT rename/ping on this
#
# Lives on fork main under scripts/tooling/lib/ — commit here; never hand-edit driver.

# ---------------------------------------------------------------------------
# Title helpers
# ---------------------------------------------------------------------------

pec_trim_ws() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    # Drop a dangling VS16 (U+FE0F) left behind after emoji strip.
    while [[ "$s" == $'\xEF\xB8\x8F'* ]]; do
        s="${s#$'\xEF\xB8\x8F'}"
        s="${s#"${s%%[![:space:]]*}"}"
    done
    printf '%s' "$s"
}

pec_strip_leading_emojis() {
    local s="$1"
    while true; do
        case "$s" in
            ✅*) s="${s#✅}" ;;
            🔁*) s="${s#🔁}" ;;
            ⚠️*) s="${s#⚠️}" ;;
            📝*) s="${s#📝}" ;;
            🔧*) s="${s#🔧}" ;;
            "?"*) s="${s#\?}" ;;
            *) break ;;
        esac
        s="$(pec_trim_ws "$s")"
    done
    printf '%s' "$s"
}

pec_normalize_title_base() {
    local s="$1"
    s="$(pec_trim_ws "$s")"
    while [[ "$s" == *"  "* ]]; do
        s="${s//  / }"
    done
    printf '%s' "$s"
}

# Extract PR numbers (3-4 digits) from a session title. Prints one per line.
# Handles: "PR #941:", "pr#923", "PR #941/#923:", "PR: 941", "Peer #1100:".
#
# The 3-digit floor is DELIBERATE scope protection: peer/overseer sessions carry
# internal workstream refs like "W1.6 provenance (#22)" whose 1-2 digit numbers
# would otherwise cross-wire to unrelated upstream tiann/hapi PRs of the same
# number. Upstream PRs relevant to this fork are all 3-4 digits. For a rare
# low-numbered upstream PR (#48, #75) use `--pr <N>` explicitly.
pec_extract_pr_numbers() {
    local name="$1"
    local re_multi re_peer
    re_multi='[Pp][Rr][[:space:]]*#([0-9]{3,4})/#([0-9]{3,4})'
    re_peer='[Pp]eer[[:space:]#:]*#?([0-9]{3,4})'
    if [[ "$name" =~ [Pp][Rr][[:space:]]*#?([0-9]{3,4}):[[:space:]]*#?([0-9]{3,4}) ]]; then
        echo "${BASH_REMATCH[1]}"; echo "${BASH_REMATCH[2]}"; return
    fi
    if [[ "$name" =~ [Pp][Rr][[:space:]]*#?([0-9]{3,4})[[:space:]]+#?([0-9]{3,4}): ]]; then
        echo "${BASH_REMATCH[1]}"; echo "${BASH_REMATCH[2]}"; return
    fi
    if [[ "$name" =~ $re_multi ]]; then
        echo "${BASH_REMATCH[1]}"; echo "${BASH_REMATCH[2]}"; return
    fi
    if [[ "$name" =~ [Pp][Rr]:[[:space:]]*#?([0-9]{3,4}) ]]; then
        echo "${BASH_REMATCH[1]}"; return
    fi
    local first
    first="$(printf '%s' "$name" | grep -oiE '[Pp][Rr][[:space:]]*#?[0-9]{3,4}' | head -1 | grep -oE '[0-9]{3,4}' || true)"
    [[ -n "$first" ]] && { echo "$first"; return; }
    if [[ "$name" =~ $re_peer ]]; then
        echo "${BASH_REMATCH[1]}"; return
    fi
    printf '%s' "$name" | grep -oiE 'pr[#: ]*#?[0-9]{3,4}|#[0-9]{3,4}' \
        | grep -oE '[0-9]{3,4}' | head -1
}

# Strip emoji + "PR #N:" / "Peer #N:" marker from a title, returning the base label.
pec_title_base_from() {
    local name="$1" pr="$2" base marker
    name="$(pec_strip_leading_emojis "$name")"
    for marker in "PR #${pr}:" "pr#${pr}:" "PR #${pr} " "pr#${pr} " \
        "PR: ${pr}:" "PR: ${pr} " "PR:${pr}:" "PR:${pr} " \
        "Peer #${pr}:" "peer #${pr}:"; do
        if [[ "$name" == *"$marker"* ]]; then
            base="${name##*"$marker"}"
            base="$(pec_normalize_title_base "$(pec_trim_ws "$base")")"
            [[ "$base" == [Pp]eer[[:space:]#]*#"${pr}"*:* ]] && base="${base#*:}" && base="$(pec_normalize_title_base "$(pec_trim_ws "$base")")"
            printf '%s' "$base"
            return
        fi
    done
    pec_normalize_title_base "$(pec_trim_ws "$name")"
}

pec_title_base_multi_from() {
    local name="$1" p1="$2" p2="$3" base marker
    name="$(pec_strip_leading_emojis "$name")"
    for marker in "PR #${p1}/#${p2}:" "pr#${p1}/${p2}:" "PR #${p1}/#${p2} " "pr#${p1}/${p2} " \
        "PR #${p1} #${p2}:" "pr#${p1} #${p2}:" \
        "PR #${p1}: #${p2}:" "pr#${p1}: #${p2}:"; do
        if [[ "$name" == *"$marker"* ]]; then
            base="${name##*"$marker"}"
            pec_normalize_title_base "$(pec_trim_ws "$base")"
            return
        fi
    done
    pec_title_base_from "$name" "$p1"
}

# Build a canonical single-PR title. pre_pr=1 → "📝Peer #N:", else "<emoji>PR #N:".
pec_build_title() {
    local emoji="$1" pr="$2" base="$3" pre_pr="${4:-0}"
    base="$(pec_title_base_from "$base" "$pr")"
    [[ -n "$base" ]] || base="session"
    if [[ "$pre_pr" == "1" ]]; then
        echo "${emoji}Peer #${pr}: ${base}"
    else
        echo "${emoji}PR #${pr}: ${base}"
    fi
}

# Severity ordering — higher rank wins when a session tracks multiple PRs.
pec_emoji_rank() {
    case "$1" in
        "?") echo 6 ;;
        ⚠️) echo 5 ;;
        🔁) echo 4 ;;
        ✅) echo 3 ;;
        📝) echo 2 ;;
        🔧) echo 1 ;;
        *) echo 0 ;;
    esac
}

pec_worst_emoji() {
    local a="$1" b="$2"
    if [[ "$(pec_emoji_rank "$a")" -ge "$(pec_emoji_rank "$b")" ]]; then
        echo "$a"
    else
        echo "$b"
    fi
}

pec_leading_emoji() {
    local s="$1"
    case "$s" in
        ✅*) echo "✅" ;;
        🔁*) echo "🔁" ;;
        ⚠️*) echo "⚠️" ;;
        📝*) echo "📝" ;;
        🔧*) echo "🔧" ;;
        "?"*) echo "?" ;;
        *) echo "" ;;
    esac
}

# ---------------------------------------------------------------------------
# Classification decision (pure) — inputs are booleans (0/1) + thread count.
#
# Usage:
#   pec_decide_emoji EXISTS MERGED CLOSED CHECKS_OK CHECKS_PENDING CHECKS_SEEN \
#                    THREADS_N BOT_CLEAN BOT_MAJOR BOT_HAS_BODY MERGE_BAD DATA_UNAVAILABLE
#   → prints "<emoji>\t<action>"
#
# THREADS_N: >=0 real count, -1 = unavailable this run.
# ---------------------------------------------------------------------------

pec_decide_emoji() {
    local exists="$1" merged="$2" closed="$3" checks_ok="$4" checks_pending="$5" \
        checks_seen="$6" threads_n="$7" bot_clean="$8" bot_major="$9" \
        bot_has_body="${10}" merge_bad="${11}" data_unavailable="${12}"

    if [[ "$data_unavailable" == "1" ]]; then
        printf '%s\t%s' "?" "GitHub data unavailable this run — retry sweep (title unchanged)"
        return
    fi
    if [[ "$exists" != "1" ]]; then
        printf '%s\t%s' "📝" "pre-PR — no open PR on upstream yet; file when ready"
        return
    fi
    if [[ "$merged" == "1" ]]; then
        # Keep in sync with docs/tooling/feature-work-lifecycle.md § After upstream merge.
        printf '%s\t%s' "🔧" "MERGED — notify peer: (1) drop soup layer(s) (2) remove worktree+branch (3) ack; do NOT self-archive mid-turn (orphans tool UI); meta rematerializes soup once wave cleanup done, then archives when idle"
        return
    fi
    if [[ "$closed" == "1" ]]; then
        printf '%s\t%s' "⚠️" "PR closed WITHOUT merge — reopen if still wanted, or drop the tracking/session"
        return
    fi

    local parts=()
    [[ "$merge_bad" == "1" ]] && parts+=("rebase (merge state dirty)")
    if [[ "$checks_ok" == "0" && "$checks_pending" == "1" ]]; then
        parts+=("CI running")
    elif [[ "$checks_ok" == "0" ]]; then
        parts+=("fix failing CI")
    fi
    [[ "$threads_n" -gt 0 ]] 2>/dev/null && parts+=("resolve ${threads_n} open thread(s)")
    [[ "$threads_n" -lt 0 ]] 2>/dev/null && parts+=("thread count unavailable (retry)")
    if [[ "$bot_clean" == "0" && "$bot_major" == "1" ]]; then
        parts+=("address bot [Major] findings")
    elif [[ "$bot_clean" == "0" && "$bot_has_body" == "1" ]]; then
        parts+=("address latest bot review")
    elif [[ "$bot_clean" == "0" ]]; then
        parts+=("push to trigger bot review")
    fi

    local emoji action
    if [[ "$checks_ok" == "1" && "$checks_seen" == "1" && "$threads_n" == "0" && "$bot_clean" == "1" && "$merge_bad" == "0" ]]; then
        emoji="✅"; action="full green — wait on tiann"
    elif [[ "$checks_seen" == "0" && "$merge_bad" == "0" && "$bot_major" == "0" ]]; then
        # No CI evidence yet: never call it green. Nudge instead of false ✅.
        emoji="🔁"; action="no CI checks visible yet — push/retry then re-sweep"
    elif [[ "$checks_pending" == "1" && "$threads_n" == "0" && "$bot_major" == "0" && "$merge_bad" == "0" ]]; then
        emoji="🔁"; action="$([[ ${#parts[@]} -gt 0 ]] && (IFS='; '; echo "${parts[*]}") || echo "CI in flight")"
    elif [[ "$checks_ok" == "1" && "$checks_seen" == "1" && "$threads_n" -lt 0 && "$bot_clean" == "1" && "$merge_bad" == "0" ]] 2>/dev/null; then
        emoji="🔁"; action="CI/bot green — thread count unavailable; retry sweep"
    else
        emoji="⚠️"; action="$(IFS='; '; echo "${parts[*]}")"
        [[ -n "$action" ]] || action="needs attention — run hapi-pr-status"
    fi
    printf '%s\t%s' "$emoji" "$action"
}

# ---------------------------------------------------------------------------
# Ping policy (pure)
# ---------------------------------------------------------------------------

# Stable, deterministic fingerprint of a disposition (emoji + action string).
pec_action_fingerprint() {
    local emoji="$1" action="$2"
    printf '%s|%s' "$emoji" "$action" | cksum | awk '{print $1}'
}

# Decide whether to ping a session, given its previous recorded state.
#   pec_should_ping NEW_EMOJI PREV_EMOJI NEW_FP PREV_FP LAST_PING_EPOCH NOW_EPOCH REMINDER_SECS
# Prints "yes" / "no" and returns 0/1 respectively.
#
# Rules:
#   - "?" (unknown)                     → never ping
#   - emoji changed vs recorded state   → ping (transition)
#   - sticky ⚠️ or 🔧:
#       - action fingerprint changed    → ping (new instruction)
#       - reminder interval elapsed      → ping (nag)
#       - otherwise                      → no
#   - unchanged ✅ / 🔁 / 📝            → no
pec_should_ping() {
    local new_emoji="$1" prev_emoji="$2" new_fp="$3" prev_fp="$4" \
        last_ping="${5:-0}" now="${6:-0}" reminder="${7:-86400}"

    if [[ "$new_emoji" == "?" ]]; then
        echo "no"; return 1
    fi
    if [[ "$new_emoji" != "$prev_emoji" ]]; then
        echo "yes"; return 0
    fi
    if [[ "$new_emoji" == "⚠️" || "$new_emoji" == "🔧" ]]; then
        if [[ "$new_fp" != "$prev_fp" ]]; then
            echo "yes"; return 0
        fi
        if [[ "$last_ping" -gt 0 && "$now" -gt 0 ]] 2>/dev/null; then
            if (( now - last_ping >= reminder )); then
                echo "yes"; return 0
            fi
        fi
    fi
    echo "no"; return 1
}

# Rename is warranted whenever the computed title differs from the live one AND
# the computed emoji is a real disposition (never rewrite to "?").
pec_should_rename() {
    local new_title="$1" cur_title="$2" new_emoji="$3"
    [[ "$new_emoji" == "?" ]] && { echo "no"; return 1; }
    if [[ "$new_title" != "$cur_title" ]]; then
        echo "yes"; return 0
    fi
    echo "no"; return 1
}

# ---------------------------------------------------------------------------
# Channel event emit helpers (ContributionState → POST /api/system-events)
# ---------------------------------------------------------------------------

# pec_emit_reason NEW_EMOJI PREV_EMOJI NEW_FP PREV_FP LAST_PING NOW REMINDER
# → transition | fingerprint | reminder | none
# Same triggers as pec_should_ping, but returns why (reminder needs key suffix).
pec_emit_reason() {
    local new_emoji="$1" prev_emoji="$2" new_fp="$3" prev_fp="$4" \
        last_ping="${5:-0}" now="${6:-0}" reminder="${7:-86400}"

    if [[ "$new_emoji" == "?" ]]; then
        echo "none"; return 1
    fi
    if [[ "$new_emoji" != "$prev_emoji" ]]; then
        echo "transition"; return 0
    fi
    if [[ "$new_emoji" == "⚠️" || "$new_emoji" == "🔧" ]]; then
        if [[ "$new_fp" != "$prev_fp" ]]; then
            echo "fingerprint"; return 0
        fi
        if [[ "$last_ping" -gt 0 && "$now" -gt 0 ]] 2>/dev/null; then
            if (( now - last_ping >= reminder )); then
                echo "reminder"; return 0
            fi
        fi
    fi
    echo "none"; return 1
}

# pec_event_type_for_emoji EMOJI [orphan]
pec_event_type_for_emoji() {
    local emoji="$1" mode="${2:-}"
    if [[ "$mode" == "orphan" ]]; then
        echo "needs_decision"
        return 0
    fi
    case "$emoji" in
        ⚠️) echo "blocked" ;;
        🔧) echo "completed" ;;
        ✅|🔁|📝) echo "progress" ;;
        *) echo "needs_decision" ;;
    esac
}

# pec_contrib_idempotency_key REPO NUMBER FINGERPRINT [KIND] [DATE] [SESSION]
# Session-bound events append ":sess:<id>" so multiple sessions tracking the
# same PR do not collide on the hub's UNIQUE idempotency/dedupe indexes.
# Orphan/unbound events (empty SESSION) stay PR-scoped.
pec_contrib_idempotency_key() {
    local repo="$1" number="$2" fp="$3" kind="${4:-}" date="${5:-}" session="${6:-}"
    local key="contrib:${repo}#${number}:${fp}"
    [[ -n "$session" ]] && key="${key}:sess:${session}"
    if [[ "$kind" == "reminder" && -n "$date" ]]; then
        key="${key}:reminder:${date}"
    fi
    printf '%s' "$key"
}

# pec_contrib_dedupe_key REPO NUMBER EVENT_TYPE FINGERPRINT [KIND] [DATE] [SESSION]
# Must be unique per insert identity — events.dedupe_key has a UNIQUE index.
# Align with idempotency by embedding the fingerprint (and the session when
# bound, and the reminder date when nagging).
pec_contrib_dedupe_key() {
    local repo="$1" number="$2" event_type="$3" fp="$4" kind="${5:-}" date="${6:-}" session="${7:-}"
    local key="contrib:${repo}#${number}:${event_type}:${fp}"
    [[ -n "$session" ]] && key="${key}:sess:${session}"
    if [[ "$kind" == "reminder" && -n "$date" ]]; then
        key="${key}:reminder:${date}"
    fi
    printf '%s' "$key"
}

# pec_resolve_tool DIR PRIMARY INJECTED NAME
# Resolve a sibling operator tool with a robust precedence:
#   1. explicit injection (INJECTED non-empty) — highest priority
#   2. same-dir (DIR/NAME) if it exists — normal mirror layout
#   3. canonical PRIMARY/scripts/tooling/NAME — soup/driver packaging where the
#      low-level batch/ping tools are not copied alongside meta-daily
# Never probes the network; pure path arithmetic + existence check.
pec_resolve_tool() {
    local dir="$1" primary="$2" injected="$3" name="$4"
    if [[ -n "$injected" ]]; then printf '%s' "$injected"; return 0; fi
    if [[ -e "$dir/$name" ]]; then printf '%s' "$dir/$name"; return 0; fi
    printf '%s' "$primary/scripts/tooling/$name"
}

pec_pr_target_for_repo() {
    case "$1" in
        tiann/hapi) printf '%s\t%s' "upstream" "theirs" ;;
        heavygee/hapi) printf '%s\t%s' "fork" "ours" ;;
        *) printf '%s\t%s' "upstream" "theirs" ;;
    esac
}

pec_severity_for_emoji() {
    case "$1" in
        ⚠️) echo 3 ;;
        🔧) echo 2 ;;
        ✅|🔁|📝) echo 1 ;;
        *) echo 2 ;;
    esac
}

# Build a channel SystemEvent JSON body for POST /api/system-events.
# Flags: --repo --number --emoji --action --fingerprint --session-id --reason
#        --date YYYY-MM-DD [--notif] [--url]
pec_build_channel_event_body() {
    local repo="" number="" emoji="" action="" fingerprint="" session_id="" \
        reason="transition" date="" notif=0 url="" title=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo) repo="$2"; shift 2 ;;
            --number) number="$2"; shift 2 ;;
            --emoji) emoji="$2"; shift 2 ;;
            --action) action="$2"; shift 2 ;;
            --fingerprint) fingerprint="$2"; shift 2 ;;
            --session-id) session_id="$2"; shift 2 ;;
            --reason) reason="$2"; shift 2 ;;
            --date) date="$2"; shift 2 ;;
            --notif) notif=1; shift ;;
            --url) url="$2"; shift 2 ;;
            --title) title="$2"; shift 2 ;;
            *) echo "pec_build_channel_event_body: unknown arg $1" >&2; return 2 ;;
        esac
    done
    [[ -n "$repo" && -n "$number" && -n "$emoji" && -n "$fingerprint" && -n "$date" ]] \
        || { echo "pec_build_channel_event_body: missing required fields" >&2; return 2; }

    local event_type mode="" rem_kind="" rem_date=""
    [[ -z "$session_id" && "$emoji" == "⚠️" ]] && mode="orphan"
    [[ "$notif" -eq 1 ]] && mode="orphan"  # needs_decision taxonomy for notifs
    event_type="$(pec_event_type_for_emoji "$emoji" "$mode")"
    if [[ "$notif" -eq 1 ]]; then
        event_type="needs_decision"
    fi
    if [[ "$reason" == "reminder" ]]; then
        rem_kind="reminder"
        rem_date="$date"
    fi

    local idempo dedupe target control severity summary op_req=1
    idempo="$(pec_contrib_idempotency_key "$repo" "$number" "$fingerprint" "$rem_kind" "$rem_date" "$session_id")"
    dedupe="$(pec_contrib_dedupe_key "$repo" "$number" "$event_type" "$fingerprint" "$rem_kind" "$rem_date" "$session_id")"
    IFS=$'\t' read -r target control <<<"$(pec_pr_target_for_repo "$repo")"
    severity="$(pec_severity_for_emoji "$emoji")"
    [[ "$emoji" == "✅" || "$emoji" == "🔁" || "$emoji" == "📝" ]] && op_req=0

    summary="${action:-ContributionState $emoji}"
    [[ ${#summary} -gt 280 ]] && summary="${summary:0:277}..."
    [[ -z "$url" ]] && url="https://github.com/${repo}/pull/${number}"
    # PR/issue titles run long; keep the artifact label human-scannable.
    [[ ${#title} -gt 120 ]] && title="${title:0:117}..."

    local github_state="open"
    [[ "$emoji" == "🔧" ]] && github_state="merged"

    jq -cn \
        --arg sourceRef "contrib-state:${repo}" \
        --arg eventType "$event_type" \
        --argjson attention 1 \
        --argjson opReq "$op_req" \
        --arg summary "$summary" \
        --arg sessionId "$session_id" \
        --arg repo "$repo" \
        --argjson number "$number" \
        --arg url "$url" \
        --arg target "$target" \
        --arg control "$control" \
        --arg ghState "$github_state" \
        --arg emoji "$emoji" \
        --arg action "$action" \
        --arg reason "$reason" \
        --arg dedupe "$dedupe" \
        --arg idempo "$idempo" \
        --arg title "$title" \
        --argjson severity "$severity" \
        '{
            sourceKind: "channel",
            sourceRef: $sourceRef,
            eventType: $eventType,
            attentionCandidate: $attention,
            operatorActionRequired: $opReq,
            summary: $summary,
            relatedSessionId: (if $sessionId == "" then null else $sessionId end),
            artifactRefs: [(
                {
                    kind: "github_pr",
                    url: $url,
                    repo: $repo,
                    number: $number,
                    target_id: $target,
                    control: $control,
                    github_state: $ghState,
                    source: "external"
                } + (if $title == "" then {} else {title: $title} end)
            )],
            payload: { emoji: $emoji, action: $action, emitReason: $reason },
            tags: ["contrib-state"],
            dedupeKey: $dedupe,
            idempotencyKey: $idempo,
            provenance: "contrib-state@meta-daily",
            severity: $severity
        }'
}
