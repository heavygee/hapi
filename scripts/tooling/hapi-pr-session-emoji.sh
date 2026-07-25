#!/usr/bin/env bash
# hapi-pr-session-emoji — DEPRECATED (2026-07-25).
#
# Title-emoji rewrites are retired. PR health lives on the session chip via
# metadata.externalRefs.status (ADR D8 / tiann/hapi#1163). Use:
#
#   ./scripts/tooling/hapi-meta-daily.sh
#
# That classifies once, caches status onto chips, strips leading title emoji
# for chipped sessions, state-gates pings, and prints the action queue.
#
# Escape hatch (one release): HAPI_ALLOW_LEGACY_EMOJI_SWEEP=1 restores the old
# fleet retitle path. Do not use this in cron.
#
# Historical emoji contract (docs/operator/AGENTS.md § Meta PR watcher):
#   ✅ open green · 🔁 CI in flight · ⚠️ needs work · 📝 pre-PR · 🔧 merged · ? unknown
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
REPO="${HAPI_PR_REPO:-tiann/hapi}"
HAPI_HOST="${HAPI_HOST:-http://localhost:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
GH_TIMEOUT="${HAPI_GH_TIMEOUT_SECS:-20}"
PING_CONCURRENCY="${HAPI_PING_CONCURRENCY:-8}"
PING_INACTIVE="${HAPI_PING_INACTIVE:-0}"
export GH_FORCE_TTY=0

DRY_RUN=0
SWEEP=0
DO_PING=0
PR_ARG=""
RENAME_PREFIX=""
PING_PREFIX=""

declare -A BATCH_EMOJI BATCH_ACTION BATCH_EXISTS BATCH_PREPR BATCH_MERGED
declare -a PING_SIDS PING_MSGS PING_PREFIXES PING_ACTIVES
PING_MSGS_JWT=""

err() { echo "hapi-pr-session-emoji: $*" >&2; }
die() { err "$*"; exit 2; }

usage() {
    sed -n '2,20p' "$0"
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO="$2"; shift 2 ;;
        --pr) PR_ARG="$2"; shift 2 ;;
        --rename) RENAME_PREFIX="$2"; shift 2 ;;
        --ping)
            DO_PING=1
            if [[ $# -ge 2 && "$2" != --* ]]; then
                PING_PREFIX="$2"
                shift
            fi
            shift
            ;;
        --sweep) SWEEP=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --help|-h) usage ;;
        *) die "unknown arg: $1 (try --help)" ;;
    esac
done

if [[ "${HAPI_ALLOW_LEGACY_EMOJI_SWEEP:-0}" != "1" ]]; then
    cat >&2 <<'EOF'
hapi-pr-session-emoji: DEPRECATED — title emoji rewrites are retired (ADR D8).

  Use:  ./scripts/tooling/hapi-meta-daily.sh
        ./scripts/tooling/hapi-meta-daily.sh --dry-run

  Chip status cache + title emoji strip for chipped sessions live there.
  Escape hatch (not for cron): HAPI_ALLOW_LEGACY_EMOJI_SWEEP=1
EOF
    exit 2
fi
err "WARNING: legacy title-emoji sweep enabled (HAPI_ALLOW_LEGACY_EMOJI_SWEEP=1)"

batch_load() {
    local prs=("$@")
    [[ ${#prs[@]} -gt 0 ]] || return 0
    local json
    json="$(HAPI_PR_REPO="$REPO" HAPI_GH_TIMEOUT_SECS="$GH_TIMEOUT" \
        "$SCRIPT_DIR/hapi-pr-emoji-batch.sh" --repo "$REPO" --timeout "$GH_TIMEOUT" "${prs[@]}")" \
        || die "batch PR classify failed"
    while IFS= read -r pr; do
        BATCH_EMOJI[$pr]="$(echo "$json" | jq -r --arg p "$pr" '.[$p].emoji // "⚠️"')"
        BATCH_ACTION[$pr]="$(echo "$json" | jq -r --arg p "$pr" '.[$p].action // "check hapi-pr-status"')"
        BATCH_EXISTS[$pr]="$(echo "$json" | jq -r --arg p "$pr" '.[$p].exists // .[$p].inQueue // .[$p].open // false')"
        BATCH_PREPR[$pr]="$(echo "$json" | jq -r --arg p "$pr" '.[$p].prePr // false')"
        BATCH_MERGED[$pr]="$(echo "$json" | jq -r --arg p "$pr" '.[$p].merged // false')"
    done < <(printf '%s\n' "${prs[@]}" | sort -u)
}

pr_emoji_fast() {
    local pr="$1"
    [[ -n "${BATCH_EMOJI[$pr]:-}" ]] && { echo "${BATCH_EMOJI[$pr]}"; return; }
    echo "⚠️"
}

pr_action_fast() {
    local pr="$1"
    [[ -n "${BATCH_ACTION[$pr]:-}" ]] && { echo "${BATCH_ACTION[$pr]}"; return; }
    echo "Run: hapi-pr-status $pr --repo $REPO"
}

hub_jwt() {
    [[ -f "$SETTINGS" ]] || die "settings not found: $SETTINGS"
    local raw jwt
    raw="$(jq -r '.cliApiToken // empty' "$SETTINGS")"
    [[ -n "$raw" ]] || die "no cliApiToken in $SETTINGS"
    jwt="$(curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg t "$raw:default" '{accessToken:$t}')" \
        "$HAPI_HOST/api/auth" | jq -r '.token // empty')"
    [[ -n "$jwt" ]] || die "JWT exchange failed ($HAPI_HOST reachable?)"
    echo "$jwt"
}

# Pure title/emoji helpers live in lib/pr-emoji-core.sh (single source of truth,
# unit-tested). Thin delegators keep existing call sites working.
# shellcheck source=lib/pr-emoji-core.sh
source "$SCRIPT_DIR/lib/pr-emoji-core.sh"
trim_ws() { pec_trim_ws "$@"; }
strip_leading_emojis() { pec_strip_leading_emojis "$@"; }
normalize_title_base() { pec_normalize_title_base "$@"; }
title_base_from() { pec_title_base_from "$@"; }
title_base_multi_from() { pec_title_base_multi_from "$@"; }
extract_pr_numbers() { pec_extract_pr_numbers "$@"; }
build_title() { pec_build_title "$@"; }
emoji_rank() { pec_emoji_rank "$@"; }
worst_emoji() { pec_worst_emoji "$@"; }

hub_rename() {
    local sid="$1" name="$2" jwt="$3"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "  [dry-run] rename -> \"$name\""
        return 0
    fi
    curl -sS --max-time 10 -X PATCH -H "Authorization: Bearer $jwt" \
        -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg n "$name" '{name:$n}')" \
        "$HAPI_HOST/api/sessions/$sid" | jq -e '.ok == true' >/dev/null \
        || die "rename failed for $sid"
}

_hub_send_one() {
    local sid="$1" jwt="$2" text="$3" prefix="$4" active="$5"
    if [[ "$active" != "true" && "$PING_INACTIVE" != "1" ]]; then
        echo "  [skip-ping] $prefix inactive — use: hapi-ping-peer $prefix \"...\"" >&2
        return 0
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "  [dry-run] ping $prefix (${#text} chars)"
        return 0
    fi
    if [[ "$active" != "true" ]]; then
        curl -sS --max-time 10 -X POST -H "Authorization: Bearer $jwt" \
            -H 'Content-Type: application/json' -d '{}' \
            "$HAPI_HOST/api/sessions/$sid/resume" >/dev/null || true
        local i=0
        while [[ $i -lt 8 ]]; do
            active="$(curl -sS --max-time 5 -H "Authorization: Bearer $jwt" \
                "$HAPI_HOST/api/sessions/$sid" | jq -r '.session.active // false')"
            [[ "$active" == "true" ]] && break
            sleep 1; i=$((i + 1))
        done
        [[ "$active" == "true" ]] || { echo "  [skip-ping] $prefix resume timeout" >&2; return 0; }
    fi
    local tmp; tmp="$(mktemp)"
    jq -cn --arg t "$text" '{text:$t}' >"$tmp"
    if curl -sS --max-time 15 -X POST -H "Authorization: Bearer $jwt" \
        -H 'Content-Type: application/json' -d @"$tmp" \
        "$HAPI_HOST/api/sessions/$sid/messages" | jq -e '.ok == true' >/dev/null; then
        echo "  ping OK $prefix"
    else
        echo "  ping FAIL $prefix" >&2
    fi
    rm -f "$tmp"
}

ping_all_parallel() {
    local n="${#PING_SIDS[@]}"
    [[ "$n" -eq 0 ]] && return 0
    echo ""
    echo "  phase 2: ping ${n} active session(s) in parallel..."
    for i in "${!PING_SIDS[@]}"; do
        (
            _hub_send_one "${PING_SIDS[$i]}" "${PING_MSGS_JWT}" "${PING_MSGS[$i]}" \
                "${PING_PREFIXES[$i]}" "${PING_ACTIVES[$i]}"
        ) &
    done
    wait
}

is_non_hapi_session() {
    local name="$1"
    [[ "$name" =~ [Yy][Aa][Aa][Cc][Cc] ]] && return 0
    return 1
}

process_session_row() {
    local prefix="$1" sid="$2" active="$3" name="$4" jwt="$5"
    local prs=() pr emoji combined_emoji new_title msg actions one_action

    if is_non_hapi_session "$name"; then
        err "skip $prefix — non-HAPI session (not in sweep scope)"
        return 0
    fi

    mapfile -t prs < <(extract_pr_numbers "$name")
    if [[ ${#prs[@]} -eq 0 ]]; then
        err "skip $prefix — no PR number in title: $name"
        return 0
    fi

    combined_emoji=""
    actions=""
    for pr in "${prs[@]}"; do
        emoji="$(pr_emoji_fast "$pr")"
        if [[ -z "$combined_emoji" ]]; then
            combined_emoji="$emoji"
        else
            combined_emoji="$(worst_emoji "$combined_emoji" "$emoji")"
        fi
        one_action="$(pr_action_fast "$pr")"
        if [[ ${#prs[@]} -gt 1 ]]; then
            actions+="- **#$pr:** $one_action"$'\n'
        else
            actions="$one_action"
        fi
        echo "  PR #$pr -> $emoji"
    done

    if [[ "$combined_emoji" == "?" ]]; then
        echo "  [skip] GitHub data unavailable for #$(IFS=,; echo "${prs[*]}") — leaving title unchanged"
        return 0
    fi

    if [[ ${#prs[@]} -eq 1 ]]; then
        pre=0
        [[ "${BATCH_PREPR[${prs[0]}]:-false}" == "true" ]] && pre=1
        new_title="$(build_title "$combined_emoji" "${prs[0]}" "$name" "$pre")"
    else
        new_title="${combined_emoji}PR #${prs[0]}/#${prs[1]}: $(title_base_multi_from "$name" "${prs[0]}" "${prs[1]}")"
    fi

    if [[ "$new_title" == "$name" ]]; then
        echo "  unchanged"
        return 0
    fi

    echo "  old: $name"
    echo "  new: $new_title"
    hub_rename "$sid" "$new_title" "$jwt"

    if [[ "$DO_PING" -eq 1 ]]; then
        local state_desc="issues still open"
        [[ "$combined_emoji" == "✅" ]] && state_desc="full green upstream"
        [[ "$combined_emoji" == "🔁" ]] && state_desc="CI/rebase in flight"
        [[ "$combined_emoji" == "📝" ]] && state_desc="pre-PR — not filed on upstream yet"
        [[ "$combined_emoji" == "🔧" ]] && state_desc="merged — idle cleanly (no mid-turn self-archive); meta archives when idle or spare for follow-on"
        msg="Meta PR watcher sweep — session title is now **${combined_emoji}**.

Tracked PR(s): $(IFS=,; echo "${prs[*]}")
State: **${combined_emoji}** (${state_desc})

Keep this emoji in your session title until disposition changes.
- ✅ = open PR green — wait on tiann
- 🔁 = CI/rebase in flight
- ⚠️ = fix threads, CI, or conflicts
- 📝 = pre-PR / Peer incubating — not on upstream yet
- 🔧 = merged — clean up, idle (no mid-turn self-archive); meta archives when idle or spare with rationale

${actions}

Canon: docs/operator/AGENTS.md § Meta PR watcher"
        PING_SIDS+=("$sid")
        PING_MSGS+=("$msg")
        PING_PREFIXES+=("$prefix")
        PING_ACTIVES+=("$active")
    fi
}

if [[ -n "$PR_ARG" && "$SWEEP" -eq 0 ]]; then
    batch_load "$PR_ARG"
    emoji="$(pr_emoji_fast "$PR_ARG")"
    echo "PR #${PR_ARG} (${REPO}): ${emoji}"
    pr_action_fast "$PR_ARG"
    if [[ -n "$RENAME_PREFIX" ]]; then
        JWT="$(hub_jwt)"
        sid="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions?limit=500" \
            | jq -r --arg p "$RENAME_PREFIX" '(.sessions//.)[]|select(.id|startswith($p))|.id' | head -1)"
        [[ -n "$sid" ]] || die "no session for $RENAME_PREFIX"
        old="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$sid" \
            | jq -r '.session.metadata.name')"
        hub_rename "$sid" "$(build_title "$emoji" "$PR_ARG" "$old")" "$JWT"
        if [[ "$DO_PING" -eq 1 ]]; then
            PING_MSGS_JWT="$JWT"
            active="$(curl -sS --max-time 5 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$sid" | jq -r '.session.active // false')"
            PING_SIDS=("$sid"); PING_MSGS=("PR #${PR_ARG} is **${emoji}**. $(pr_action_fast "$PR_ARG")")
            PING_PREFIXES=("${PING_PREFIX:-$RENAME_PREFIX}"); PING_ACTIVES=("$active")
            ping_all_parallel
        fi
    fi
    exit 0
fi

if [[ "$SWEEP" -eq 1 ]]; then
    t0=$(date +%s)
    echo "hapi-pr-session-emoji: sweep on $HAPI_HOST (repo $REPO)"
    JWT="$(hub_jwt)"
    SESSIONS_JSON="$(curl -sS --max-time 15 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions?limit=500")"

    mapfile -t rows < <(echo "$SESSIONS_JSON" | jq -r '
        (.sessions // .) | .[]
        | select((.metadata.name // "") | test("Peer #[0-9]|PR #|pr#|#[0-9]{3,4}"; "i"))
        | select((.metadata.name // "") | test("yaacc"; "i") | not)
        | "\(.id[0:8])\t\(.id)\t\(.active // false)\t\(.metadata.name // "")"')

    [[ ${#rows[@]} -gt 0 ]] || { echo "No PR-tagged sessions."; exit 0; }

    declare -A seen_pr
    all_prs=()
    for row in "${rows[@]}"; do
        name="${row##*$'\t'}"
        while IFS= read -r pr; do
            [[ -n "$pr" && -z "${seen_pr[$pr]:-}" ]] && { seen_pr[$pr]=1; all_prs+=("$pr"); }
        done < <(extract_pr_numbers "$name")
    done

    echo "  phase 0: ${#rows[@]} sessions, ${#all_prs[@]} PRs — batch classify..."
    batch_load "${all_prs[@]}"
    echo "  phase 0 done in $(( $(date +%s) - t0 ))s"
    echo "  phase 1: rename..."

    for row in "${rows[@]}"; do
        IFS=$'\t' read -r prefix sid active name <<< "$row"
        echo ""
        echo "── $prefix: $name"
        process_session_row "$prefix" "$sid" "$active" "$name" "$JWT" || err "failed $prefix"
    done

    echo "  phase 1 done in $(( $(date +%s) - t0 ))s"
    if [[ "$DO_PING" -eq 1 ]]; then
        PING_MSGS_JWT="$JWT"
        ping_all_parallel
    fi
    echo ""
    echo "hapi-pr-session-emoji: complete in $(( $(date +%s) - t0 ))s"
    exit 0
fi

usage
