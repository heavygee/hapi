#!/usr/bin/env bash
# pr-hold-core — pure identity latch for operator-hold chip (🛑 / needs_operator).
# NO network. Sourced by hapi-meta-daily.sh and hapi-hold-ack.sh.
#
# Detector is identity + surface, not NLP. Kill-criterion: github-actions or
# Codex bot setting 🛑 = design failed.

pec_hold_normalize_login() {
    local s="${1:-}"
    s="${s#@}"
    printf '%s' "${s,,}"
}

# pec_hold_actor_ok LOGIN TYPE → 0 if a human that may latch, 1 if bot/noise
pec_hold_actor_ok() {
    local login type
    login="$(pec_hold_normalize_login "${1:-}")"
    type="${2:-}"
    [[ -n "$login" ]] || return 1
    [[ "$type" == "Bot" ]] && return 1
    case "$login" in
        github-actions|github-actions\[bot\]|dependabot|dependabot\[bot\]) return 1 ;;
        *\[bot\]) return 1 ;;
        *-bot) return 1 ;;
    esac
    # Codex / Actions apps often appear as User with a [bot] suffix (caught above)
    # or as Bot type. Also refuse well-known connector logins without suffix.
    case "$login" in
        chatgpt-codex-connector|chatgpt-codex-connector\[bot\]|openai-codex|openai-codex\[bot\])
            return 1
            ;;
    esac
    return 0
}

# pec_hold_logins_csv [ENV_CSV] [FILE_JSON_OR_EMPTY]
# Default: tiann. Env wins when non-empty. File JSON: {"logins":["tiann",...]}
pec_hold_logins_csv() {
    local env_csv="${1:-}" file_json="${2:-}"
    if [[ -n "$env_csv" ]]; then
        printf '%s' "$env_csv" | tr -d ' '
        return 0
    fi
    if [[ -n "$file_json" ]]; then
        local from_file
        from_file="$(printf '%s' "$file_json" | jq -r '(.logins // []) | map(ascii_downcase) | join(",")' 2>/dev/null || true)"
        if [[ -n "$from_file" && "$from_file" != "null" ]]; then
            printf '%s' "$from_file"
            return 0
        fi
    fi
    printf 'tiann'
}

pec_hold_login_allowed() {
    local login csv needle
    login="$(pec_hold_normalize_login "${1:-}")"
    csv="$(printf '%s' "${2:-}" | tr -d ' ')"
    [[ -n "$login" && -n "$csv" ]] || return 1
    IFS=',' read -r -a _hold_logins <<<"$csv"
    for needle in "${_hold_logins[@]}"; do
        needle="$(pec_hold_normalize_login "$needle")"
        [[ "$login" == "$needle" ]] && return 0
    done
    return 1
}

# pec_hold_surface_ok SURFACE [BODY]
# issue_comment always (type). review_body requires non-empty body when BODY given.
# Inline review_comment (bot Findings threads) never.
pec_hold_surface_ok() {
    local surface="${1:-}" body="${2-}"
    case "$surface" in
        issue_comment)
            return 0
            ;;
        review_body)
            if [[ $# -ge 2 ]]; then
                body="${body#"${body%%[![:space:]]*}"}"
                body="${body%"${body##*[![:space:]]}"}"
                [[ -n "$body" ]] || return 1
            fi
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# pec_hold_should_latch SURFACE LOGIN TYPE BODY LOGINS_CSV
pec_hold_should_latch() {
    local surface="${1:-}" login="${2:-}" type="${3:-}" body="${4:-}" csv="${5:-tiann}"
    pec_hold_actor_ok "$login" "$type" || return 1
    pec_hold_login_allowed "$login" "$csv" || return 1
    pec_hold_surface_ok "$surface" "$body" || return 1
    return 0
}

pec_hold_fingerprint() {
    local repo="${1:-}" pr="${2:-}" surface="${3:-}" comment_id="${4:-}"
    printf '%s#%s:%s:%s' "$repo" "$pr" "$surface" "$comment_id"
}

pec_hold_state_key() {
    local repo="${1:-}" pr="${2:-}"
    printf '%s#%s' "$repo" "$pr"
}

pec_hold_excerpt() {
    local s="${1:-}"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    s="${s//$'\n'/ }"
    if [[ ${#s} -gt 140 ]]; then
        s="${s:0:140}"
    fi
    printf '%s' "$s"
}

# pec_hold_overlay_emoji LIVE_EMOJI STATE_JSON REPO PR
pec_hold_overlay_emoji() {
    local live="${1:-?}" state="${2-}" repo="${3:-}" pr="${4:-}"
    local key
    [[ -n "$state" ]] || state='{}'
    key="$(pec_hold_state_key "$repo" "$pr")"
    # jq `//` treats JSON false as missing — test `== false` explicitly.
    if printf '%s' "$state" | jq -e --arg k "$key" '.hold[$k].acked == false' >/dev/null 2>&1; then
        printf '🛑'
        return 0
    fi
    printf '%s' "$live"
}

# pec_hold_is_new_latch STATE_JSON REPO PR SURFACE COMMENT_ID [CREATED_AT]
# New when this (surface, comment_id) is not already the recorded fingerprint.
# Issue-comment ids and review ids are different GitHub namespaces — same
# numeric id on a different surface is a distinct event. Acked same pair must
# NOT re-latch. When both sides have created_at:
#   - strictly later → new
#   - older → not new
#   - equal second (GitHub ts is 1s resolution) + different pair → new only after
#     operator ack AND the sibling fingerprint is not already in acked_fps
#     (otherwise A↔B equal-time siblings alternate forever — #124 Codex P2)
pec_hold_is_new_latch() {
    local state="${1-}" repo="${2:-}" pr="${3:-}" surface="${4:-}" comment_id="${5:-}" created_at="${6:-}"
    local key fp existing_id existing_at existing_surface
    [[ -n "$state" ]] || state='{}'
    key="$(pec_hold_state_key "$repo" "$pr")"
    fp="$(pec_hold_fingerprint "$repo" "$pr" "$surface" "$comment_id")"
    existing_id="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].comment_id // empty' 2>/dev/null || true)"
    existing_at="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].created_at // empty' 2>/dev/null || true)"
    existing_surface="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].surface // empty' 2>/dev/null || true)"
    # Already acknowledged identity (surface:id) — never re-latch, even at equal ts.
    if [[ -n "$fp" ]] && printf '%s' "$state" | jq -e --arg k "$key" --arg fp "$fp" '
        ((.hold[$k].acked_fps // []) | index($fp)) != null
    ' >/dev/null 2>&1; then
        return 1
    fi
    if [[ -n "$comment_id" && "$existing_id" == "$comment_id" ]]; then
        # Legacy rows lack surface — treat missing as matching any surface for
        # same-id sticky ack. Once upserted with surface, only equal pairs match.
        if [[ -z "$existing_surface" || "$existing_surface" == "$surface" ]]; then
            return 1
        fi
    fi
    if [[ -n "$created_at" && -n "$existing_at" && "$existing_at" != "null" ]]; then
        if [[ "$created_at" < "$existing_at" ]]; then
            return 1
        fi
        if [[ "$created_at" == "$existing_at" ]]; then
            if printf '%s' "$state" | jq -e --arg k "$key" '.hold[$k].acked == false' >/dev/null 2>&1; then
                return 1
            fi
            [[ -n "$fp" ]]
            return $?
        fi
        [[ -n "$fp" ]]
        return $?
    fi
    [[ -n "$fp" ]]
}

# pec_hold_ack_state STATE_JSON REPO PR → new state JSON
# Marks acked and appends the current fingerprint to acked_fps so equal-time
# siblings acknowledged earlier cannot re-latch after the next sibling is acked.
# Legacy rows may lack fingerprint — derive from surface+comment_id when missing.
pec_hold_ack_state() {
    local state="${1-}" repo="${2:-}" pr="${3:-}"
    local key fp surface cid
    [[ -n "$state" ]] || state='{}'
    key="$(pec_hold_state_key "$repo" "$pr")"
    surface="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].surface // "issue_comment"' 2>/dev/null || true)"
    cid="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].comment_id // empty' 2>/dev/null || true)"
    fp="$(printf '%s' "$state" | jq -r --arg k "$key" '.hold[$k].fingerprint // empty' 2>/dev/null || true)"
    if [[ -z "$fp" && -n "$cid" ]]; then
        fp="$(pec_hold_fingerprint "$repo" "$pr" "$surface" "$cid")"
    fi
    printf '%s' "$state" | jq -c --arg k "$key" --arg fp "$fp" '
        if (.hold[$k] | type) == "object" then
            .hold[$k].acked = true
            | (if ($fp | length) > 0 and ((.hold[$k].fingerprint // "") | length) == 0 then
                .hold[$k].fingerprint = $fp
              else . end)
            | .hold[$k].acked_fps = (
                ((.hold[$k].acked_fps // []) + [$fp] )
                | map(select(. != null and . != ""))
                | unique
              )
        else
            .
        end
    '
}

# pec_hold_upsert_state STATE_JSON REPO PR SURFACE COMMENT_ID AUTHOR URL EXCERPT [CREATED_AT]
# Writes/replaces the unacked hold row. Sets notified=false for a new fingerprint.
# Preserves acked_fps so previously acknowledged equal-time siblings stay dead.
pec_hold_upsert_state() {
    local state="${1-}" repo="${2:-}" pr="${3:-}" surface="${4:-}" comment_id="${5:-}" \
        author="${6:-}" url="${7:-}" excerpt="${8:-}" created_at="${9:-}"
    [[ -n "$state" ]] || state='{}'
    local key fp
    key="$(pec_hold_state_key "$repo" "$pr")"
    fp="$(pec_hold_fingerprint "$repo" "$pr" "$surface" "$comment_id")"
    excerpt="$(pec_hold_excerpt "$excerpt")"
    # jq object constructors cannot take a bare `and` as a value — wrap in `if`.
    printf '%s' "$state" | jq -c \
        --arg k "$key" --arg repo "$repo" --arg pr "$pr" --arg surface "$surface" \
        --arg cid "$comment_id" --arg author "$author" --arg url "$url" \
        --arg excerpt "$excerpt" --arg fp "$fp" --arg created_at "$created_at" '
        .hold = (.hold // {})
        | (.hold[$k] // {}) as $prev
        | .hold[$k] = {
            pr: $pr,
            repo: $repo,
            surface: $surface,
            comment_id: $cid,
            author: $author,
            url: $url,
            excerpt: $excerpt,
            fingerprint: $fp,
            created_at: $created_at,
            acked: false,
            notified: (if ($prev.fingerprint // "") == $fp then ($prev.notified == true) else false end),
            acked_fps: ($prev.acked_fps // [])
        }
    '
}

# pec_hold_mark_notified STATE_JSON REPO PR
pec_hold_mark_notified() {
    local state="${1-}" repo="${2:-}" pr="${3:-}"
    [[ -n "$state" ]] || state='{}'
    local key
    key="$(pec_hold_state_key "$repo" "$pr")"
    printf '%s' "$state" | jq -c --arg k "$key" '
        if (.hold[$k] | type) == "object" then
            .hold[$k].notified = true
        else
            .
        end
    '
}

# pec_hold_action_from_state STATE_JSON REPO PR → statusAction string
pec_hold_action_from_state() {
    local state="${1-}" repo="${2:-}" pr="${3:-}"
    [[ -n "$state" ]] || state='{}'
    local key
    key="$(pec_hold_state_key "$repo" "$pr")"
    printf '%s' "$state" | jq -r --arg k "$key" '
        (.hold[$k] // {}) as $h
        | if ($h.acked == false) then
            ("HOLD @" + ($h.author // "?") + ": " + ($h.excerpt // "") + (if ($h.url // "") != "" then " " + $h.url else "" end))
          else
            empty
          end
    '
}
