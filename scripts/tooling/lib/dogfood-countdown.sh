#!/usr/bin/env bash
# dogfood-countdown.sh — 48h UTC opt-out window for the `dogfooded` label.
#
# Public process: tiann/hapi#2082 (Discussion create was FORBIDDEN for write
# collaborators; Issue is the standing thread until Announcements is opened).
#
# Sourced by hapi-pr-merge-gate.sh and hapi-pr-emoji-batch.sh.
# Window length: 48 calendar hours from the GitHub "labeled" event timestamp
# (fallback: parse "dogfooded since <ISO>" from PR comments).

DOGFOOD_WINDOW_SECS="${DOGFOOD_WINDOW_SECS:-$((48 * 3600))}"

# dogfood_has_label LABELS_CSV → 0 if dogfooded present (case-insensitive)
dogfood_has_label() {
    local labels_lc
    labels_lc="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
    printf '%s' ",${labels_lc}," | grep -Fq ",dogfooded,"
}

# dogfood_labeled_at REPO PR → ISO-8601 UTC on stdout, or empty
# Prefers issues/<n>/events labeled timestamp; falls back to PR comment stamp.
dogfood_labeled_at() {
    local repo="$1" pr="$2"
    local real_gh="${HAPI_REAL_GH:-${REAL_GH:-/usr/bin/gh}}"
    local at
    # --paginate + --jq filters each page; take the chronologically last stamp.
    at="$("$real_gh" api "repos/${repo}/issues/${pr}/events" --paginate \
        --jq '.[] | select(.event=="labeled" and (.label.name|ascii_downcase)=="dogfooded") | .created_at' \
        2>/dev/null | tail -1 || true)"
    if [[ -n "$at" && "$at" != "null" ]]; then
        printf '%s\n' "$at"
        return 0
    fi
    # Fallback: "dogfooded since 2026-10-21T11:43:07Z"
    at="$("$real_gh" pr view "$pr" --repo "$repo" --json comments \
        --jq '[.comments[].body | capture("dogfooded since (?<t>[0-9T:Z.-]+)"; "i") | .t] | last // empty' \
        2>/dev/null || true)"
    if [[ -n "$at" && "$at" != "null" ]]; then
        printf '%s\n' "$at"
        return 0
    fi
    return 1
}

# dogfood_secs_remaining LABELED_AT_ISO [NOW_EPOCH] → integer seconds (>=0 waiting, 0 ready)
dogfood_secs_remaining() {
    local labeled="$1" now_epoch="${2:-}"
    local labeled_epoch
    labeled_epoch="$(date -u -d "$labeled" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$labeled" +%s 2>/dev/null || echo "")"
    [[ -n "$labeled_epoch" ]] || { echo "ERR"; return 1; }
    [[ -n "$now_epoch" ]] || now_epoch="$(date -u +%s)"
    local elapsed=$((now_epoch - labeled_epoch))
    local left=$((DOGFOOD_WINDOW_SECS - elapsed))
    if [[ "$left" -lt 0 ]]; then
        echo 0
    else
        echo "$left"
    fi
}

# dogfood_humanize_secs SECS → "12h 4m" / "ready"
dogfood_humanize_secs() {
    local s="${1:-0}"
    if [[ "$s" -le 0 ]]; then
        echo "ready"
        return
    fi
    local h=$((s / 3600)) m=$(((s % 3600) / 60))
    if [[ "$h" -gt 0 ]]; then
        echo "${h}h ${m}m"
    else
        echo "${m}m"
    fi
}

# dogfood_status_for_pr REPO PR LABELS_CSV
# Prints one of:
#   not_labeled
#   waiting<TAB><secs><TAB><human>
#   ready<TAB>0<TAB>ready
#   unknown  (label present but no timestamp)
dogfood_status_for_pr() {
    local repo="$1" pr="$2" labels="${3:-}"
    if ! dogfood_has_label "$labels"; then
        echo "not_labeled"
        return 0
    fi
    local at rem human
    if ! at="$(dogfood_labeled_at "$repo" "$pr")"; then
        echo "unknown"
        return 0
    fi
    rem="$(dogfood_secs_remaining "$at")" || { echo "unknown"; return 0; }
    [[ "$rem" != "ERR" ]] || { echo "unknown"; return 0; }
    human="$(dogfood_humanize_secs "$rem")"
    if [[ "$rem" -gt 0 ]]; then
        printf 'waiting\t%s\t%s\n' "$rem" "$human"
    else
        printf 'ready\t0\tready\n'
    fi
}
