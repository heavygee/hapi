#!/usr/bin/env bash
# hapi-meta-daily — one deterministic morning command for the Meta PR watcher.
#
# WHAT IT DOES (idempotent, safe by default):
#   1. Discovers the union of: open heavygee PRs on tiann/hapi, recently-merged
#      tracked PRs, and every hub session with a linked github_pr chip on
#      tiann/hapi | heavygee/hapi. Session TITLES ARE IGNORED for routing
#      (2026-08-06 Sparling: bare/Peer/PR title scrapes cross-wired foreign repos).
#   2. Classifies each PR ONCE (hapi-pr-emoji-batch.sh → pr-emoji-core).
#   3. For sessions with a PR chip (externalRefs): strips leading status emoji
#      and "PR #N:" prefixes from the title (chip owns identity + health —
#      ADR D8+). Never writes emoji or PR-number prefixes into titles.
#      Keeps "Peer #N:" incubating titles (no issue chip yet).
#   4. Pings a session ONLY when policy says it is actionable and not noise
#      (ping windows: always rouse sticky ⚠️/🔧 incl. inactive resume;
#      🧹 complete never pings; transition / fingerprint / reminder for greens)
#   5. Reads GitHub notifications for tiann/hapi + heavygee/hapi since a stored
#      cursor and folds new human comms into the action queue. Never marks read.
#   6. Prints a sorted operator ACTION QUEUE (⚠️ / 🔧 / 🧹 / wave / orphans / inactive /
#      new comms) plus the non-automated next steps (sync, rematerialize).
#   7. Wave-clear (gate A): for owned 🔧 sessions, detect soup-layer + worktree
#      cleanup. Start a 30m collect fuse when members go clean; when the wave is
#      clear, unlock-ping the Meta tooling session (ping windows only). Defers
#      if hapi-driver-status --quiet reports busy (manual mid-window rebuilds).
#      Orphans never block. Meta CLI still never runs hapi-driver-rebuild.
#   8. Optional one-shot: --backfill-refs writes metadata.externalRefs from
#      title-scraped **PR #N** markers only (ADR D6 / F1). Peer #N / bare #N
#      are issue/workstream titles and must never become github_pr chips.
#      Dry by default; --apply writes. Resolve requires a real pulls API hit
#      (HTTP 404 JSON on stdout is NOT success). Backfill is the ONLY path that
#      still reads titles — daily classify/ping never does.
#
# WHAT IT WILL NEVER DO (judgment / destructive / wave-scoped — surfaced only):
#   merge upstream PRs · sync/push fork main · edit the soup manifest ·
#   rebuild/restart the driver · delete branches/worktrees · archive sessions ·
#   reply on GitHub · mark notifications read.
#   (Unlock = ping Meta tooling session; that bot MAY rematerialize.)
#
# Usage:
#   hapi-meta-daily.sh                 # classify, strip title emoji (chipped), ping, queue
#   hapi-meta-daily.sh --dry-run       # decide + print, no hub/state writes
#   hapi-meta-daily.sh --no-ping       # strip + queue, never ping
#   hapi-meta-daily.sh --emit-events   # also POST channel SystemEvents (default OFF)
#   hapi-meta-daily.sh --dry-run --emit-events  # print event bodies, zero HTTP writes
#   hapi-meta-daily.sh --backfill-refs # plan session↔PR externalRefs (no writes)
#   hapi-meta-daily.sh --backfill-refs --apply  # write inferred refs (hub PUT)
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
#   HAPI_GH_MIN_VERSION (default 2.80.0) — refuse Debian community 2.23
#   HAPI_PRIMARY        (default ~/coding/hapi) — canonical tool fallback root
#   HAPI_META_BATCH_BIN (explicit override; else same-dir, else $HAPI_PRIMARY)
#   HAPI_META_PING_BIN  (explicit override; else same-dir, else $HAPI_PRIMARY)
#   HAPI_META_TOOLING_SESSION_ID — Meta tooling bot session (unlock ping target)
#   HAPI_META_WAVE_COLLECT_SECS (default 1800) — inbox collect fuse
#   HAPI_META_MANIFEST — manifest path override (tests)
#   HAPI_META_DRIVER_STATUS_BIN — hapi-driver-status override (tests)
# Install/upgrade gh: scripts/tooling/install-gh-official.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/pr-emoji-core.sh
source "$SCRIPT_DIR/lib/pr-emoji-core.sh"
# shellcheck source=lib/meta-wave.sh
source "$SCRIPT_DIR/lib/meta-wave.sh"
# shellcheck source=lib/require-gh-version.sh
source "$SCRIPT_DIR/lib/require-gh-version.sh"
# shellcheck source=lib/hapi-manifest-path.sh
source "$SCRIPT_DIR/lib/hapi-manifest-path.sh"

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

export NO_COLOR=1 CLICOLOR=0
export GH_FORCE_TTY=0 GIT_TERMINAL_PROMPT=0 GH_PAGER=cat PAGER=cat

DRY_RUN=0
DO_PING=1
EMIT_EVENTS=0
JSON_OUT=0
VERBOSE=0
SINCE_OVERRIDE=""
REMINDER_SECS=$((24 * 3600))
PR_ONLY=""
BACKFILL_REFS=0
BACKFILL_APPLY=0

err() { echo "hapi-meta-daily: $*" >&2; }
die() { err "$*"; exit 2; }
vlog() { [[ "$VERBOSE" -eq 1 ]] && echo "  · $*" >&2 || true; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --no-ping) DO_PING=0; shift ;;
        --emit-events) EMIT_EVENTS=1; shift ;;
        --backfill-refs) BACKFILL_REFS=1; shift ;;
        --apply) BACKFILL_APPLY=1; shift ;;
        --json) JSON_OUT=1; shift ;;
        --verbose|-v) VERBOSE=1; shift ;;
        --since) SINCE_OVERRIDE="$2"; shift 2 ;;
        --reminder-hours) REMINDER_SECS=$(( ${2} * 3600 )); shift 2 ;;
        --pr) PR_ONLY="$2"; shift 2 ;;
        --help|-h) sed -n '2,55p' "$0"; exit 0 ;;
        *) die "unknown arg: $1 (try --help)" ;;
    esac
done

if [[ "$BACKFILL_APPLY" -eq 1 && "$BACKFILL_REFS" -eq 0 ]]; then
    die "--apply requires --backfill-refs"
fi
if [[ "$BACKFILL_REFS" -eq 1 && "$DRY_RUN" -eq 1 && "$BACKFILL_APPLY" -eq 1 ]]; then
    die "--backfill-refs: refuse both --dry-run and --apply"
fi

# Classify needs `gh pr checks --json`. Skip when tests inject a mock binary.
if [[ -z "${HAPI_META_GH_BIN:-}" ]]; then
    require_gh_version "$GH_BIN"
fi

# ---------------------------------------------------------------------------
# State (pure-ish: file I/O only, no network)
# ---------------------------------------------------------------------------

md_state_default() {
    jq -cn --arg up "$UPSTREAM_REPO" --arg fork "$FORK_REPO" \
        '{schema:1,last_run:null,notif_cursor:{($up):null,($fork):null},sessions:{},orphan_prs:{},notif_seen:{},wave:{status:"idle",id:"w-empty",members:[],collect_started_at:null,collect_deadline_at:null}}'
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

# Display title for a session object (mirrors web getSessionTitle):
# metadata.name → summary.text → path basename → empty.
# Used only when name is blank; we promote the fallback into metadata.name so
# Meta ownership / chips / scripts never see a hollow title field again.
md_session_display_title() {
    jq -r '
        (.metadata.name // "" | gsub("^\\s+|\\s+$";"")) as $n
        | if ($n | length) > 0 then $n
          else
            (.metadata.summary.text // "" | gsub("^\\s+|\\s+$";"")) as $s
            | if ($s | length) > 0 then $s
              else
                (.metadata.path // "" | split("/") | map(select(length>0)) | last // "")
              end
          end
    ' <<<"$1"
}

# hub_heal_blank_names <jwt> <sessions_json>
# For every session with blank/whitespace metadata.name, PATCH name from the
# display title (summary.text, else path basename). Prints heal count on stderr.
# Echoes (possibly refreshed) sessions JSON on stdout when heals applied;
# otherwise echoes the input unchanged.
hub_heal_blank_names() {
    local jwt="$1" sessions_json="$2"
    local need_refresh=0 healed=0 skipped=0
    local sid title row

    while IFS= read -r row; do
        [[ -z "$row" ]] && continue
        sid="$(jq -r '.id // empty' <<<"$row")"
        [[ -z "$sid" ]] && continue
        title="$(md_session_display_title "$row")"
        if [[ -z "$title" ]]; then
            skipped=$((skipped + 1))
            continue
        fi
        if [[ "$JSON_OUT" -eq 0 ]]; then
            echo "  heal blank name ${sid:0:8}: → \"$title\"" >&2
        fi
        if [[ "$DRY_RUN" -eq 1 ]]; then
            healed=$((healed + 1))
            continue
        fi
        if hub_rename "$jwt" "$sid" "$title"; then
            healed=$((healed + 1))
            need_refresh=1
        fi
    done < <(printf '%s' "$sessions_json" | jq -c '
        .[]
        | select(
            ((.metadata.name // "") | gsub("^\\s+|\\s+$";"") | length) == 0
          )
    ')

    if [[ "$JSON_OUT" -eq 0 && ( "$healed" -gt 0 || "$skipped" -gt 0 ) ]]; then
        echo "  blank-name heal: $healed promoted, $skipped no display title" >&2
    fi

    if [[ "$need_refresh" -eq 1 ]]; then
        hub_sessions "$jwt"
    else
        printf '%s' "$sessions_json"
    fi
}

# hub_put_external_refs <jwt> <sid> <refs-json-array>
# Writes when:
#   - normal daily run and not --dry-run, or
#   - --backfill-refs --apply
hub_put_external_refs() {
    local jwt="$1" sid="$2" refs_json="$3"
    local should_write=0
    if [[ "$BACKFILL_REFS" -eq 1 ]]; then
        [[ "$BACKFILL_APPLY" -eq 1 ]] && should_write=1
    elif [[ "$DRY_RUN" -eq 0 ]]; then
        should_write=1
    fi
    if [[ "$should_write" -eq 0 ]]; then
        echo "    [dry-run] PUT external-refs → $(printf '%s' "$refs_json" | jq -c .)" >&2
        return 0
    fi
    "$CURL_BIN" -sS --max-time 15 -X PUT -H "Authorization: Bearer $jwt" \
        -H 'Content-Type: application/json' \
        -d "$(jq -cn --argjson refs "$refs_json" '{externalRefs:$refs}')" \
        "$HAPI_HOST/api/sessions/$sid/external-refs" | jq -e '.ok == true' >/dev/null \
        || err "PUT external-refs failed for ${sid:0:8}"
}

# md_refs_apply_status <refs-json> <pr-number> <emoji> <action> <checkedAtMs>
# Returns updated refs JSON on stdout. Exit 1 if no change / skip (? emoji) / empty.
#
# Dual-write while dogfood soup still stores legacy `status` (driver tip) and
# upstream #1163 moves to forge + estateCode. Always set statusCheckedAt fresh.
# Do NOT omit `status` — preserveGithubPrStatusCache treats missing status as
# "identity-only re-link" and clobbers the incoming clock with the prior stamp
# (2026-07-30 estate-wide ❓ stale cliff).
md_refs_apply_status() {
    local refs_json="$1" pr="$2" emoji="$3" action="$4" at="$5"
    local estate_code status new_refs
    [[ -z "$refs_json" || "$refs_json" == "[]" || "$refs_json" == "null" ]] && return 1
    [[ "$emoji" == "?" || -z "$emoji" ]] && return 1
    estate_code="$(pec_estate_code_from_emoji "$emoji")"
    status="$(pec_status_from_emoji "$emoji")"
    [[ -z "$estate_code" || -z "$status" || "$status" == "unknown" ]] && return 1
    new_refs="$(printf '%s' "$refs_json" | jq -c \
        --argjson number "$pr" \
        --arg estateCode "$estate_code" \
        --arg status "$status" \
        --arg action "$action" \
        --arg emoji "$emoji" \
        --argjson at "$at" '
        map(
            if .kind == "github_pr" and (.number | tonumber) == $number then
                (
                    del(.statusAction)
                    + {
                        status: $status,
                        statusCheckedAt: $at,
                        estateCode: $estateCode
                    }
                    + (if ($action | length) > 0 then {statusAction: $action} else {} end)
                    + (if $emoji == "✅" then {openState:"open", checks:"pass", merge:"clean"}
                       elif $emoji == "🔁" then {openState:"open", checks:"pending"}
                       elif $emoji == "⚠️" then {openState:"open"}
                       elif $emoji == "🔧" then {openState:"merged"}
                       elif $emoji == "🧹" then {openState:"merged"}
                       elif $emoji == "📝" then {openState:"draft"}
                       else {} end)
                )
            else . end
        )
        ')" || return 1
    [[ "$new_refs" == "$refs_json" ]] && return 1
    printf '%s' "$new_refs"
}

# md_resolve_pr_home <number> → "repo\turl" or empty if neither forge has it.
# Prefer UPSTREAM_REPO, then FORK_REPO. Never guess repo from the number alone.
#
# CRITICAL: `gh api` on HTTP 404 still prints a JSON error body on stdout and
# exits nonzero. Do NOT treat a nonempty stdout as success (`|| true` + -n
# "$url" used to invent https://github.com/.../pull/N for pure issues).
md_resolve_pr_home() {
    local number="$1" repo url rc
    for repo in "$UPSTREAM_REPO" "$FORK_REPO"; do
        url=""
        rc=0
        url="$("$GH_BIN" api "repos/${repo}/pulls/${number}" --jq '.html_url // empty' 2>/dev/null)" || rc=$?
        if [[ "$rc" -eq 0 && -n "$url" && "$url" == https://github.com/*/pull/* ]]; then
            # Canonical URL shape required by ExternalRefSchema superRefine.
            printf '%s\thttps://github.com/%s/pull/%s\n' "$repo" "$repo" "$number"
            return 0
        fi
    done
    return 1
}

# One-shot ADR D6 backfill. Exits after printing / writing; skips emoji/ping path.
md_backfill_refs() {
    local jwt sessions_json now_ms
    jwt="$(hub_jwt)"
    sessions_json="$(hub_sessions "$jwt")"
    now_ms=$(( $(md_now) * 1000 ))

    local mode="DRY-RUN (pass --apply to write)"
    [[ "$BACKFILL_APPLY" -eq 1 ]] && mode="APPLY"

    echo "hapi-meta-daily --backfill-refs [$mode] — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Resolve order: $UPSTREAM_REPO then $FORK_REPO. Skip sessions that already have refs."
    echo ""

    # Explicit empty assign so `set -u` + ${#arr[@]} is safe when no rows hit a bucket.
    local -a PLAN_WRITE=() PLAN_SKIP=() PLAN_MISS=()
    declare -A PR_HOME_CACHE  # number -> "repo\turl"

    local sid active name existing first_pr repo url refs_json home
    while IFS=$'\t' read -r sid active name existing; do
        [[ -z "$sid" ]] && continue
        [[ "$name" =~ [Yy][Aa][Aa][Cc][Cc] ]] && continue

        # Explicit PR #N only — Peer #N / bare #N are issues (ADR D6).
        first_pr="$(md_session_linked_prs "$name" | awk '{print $1}')"
        [[ -z "$first_pr" ]] && continue

        if [[ -n "$PR_ONLY" && "$first_pr" != "$PR_ONLY" ]]; then
            continue
        fi

        if [[ -n "$existing" && "$existing" != "0" ]]; then
            PLAN_SKIP+=("${sid:0:8}  already has ${existing} ref(s)  ($name)")
            continue
        fi

        if [[ -z "${PR_HOME_CACHE[$first_pr]+x}" ]]; then
            if home="$(md_resolve_pr_home "$first_pr")"; then
                PR_HOME_CACHE["$first_pr"]="$home"
            else
                PR_HOME_CACHE["$first_pr"]=""
            fi
        fi
        home="${PR_HOME_CACHE[$first_pr]}"
        if [[ -z "$home" ]]; then
            PLAN_MISS+=("${sid:0:8}  PR #${first_pr} not on $UPSTREAM_REPO or $FORK_REPO  ($name)")
            continue
        fi
        IFS=$'\t' read -r repo url <<<"$home"

        refs_json="$(jq -cn \
            --arg repo "$repo" \
            --argjson number "$first_pr" \
            --arg url "$url" \
            --argjson linkedAt "$now_ms" \
            '[{kind:"github_pr",repo:$repo,number:$number,url:$url,role:"primary",source:"inferred",linkedAt:$linkedAt}]')"

        PLAN_WRITE+=("${sid:0:8}  →  ${repo}#${first_pr}  ($name)")
        hub_put_external_refs "$jwt" "$sid" "$refs_json" || true
    done < <(printf '%s' "$sessions_json" | jq -r '
        .[]
        | select((.metadata.name // "") | test("PR #[0-9]{3,4}|pr#[0-9]{3,4}|PR:[[:space:]]*#?[0-9]{3,4}"; "i"))
        | [
            .id,
            (.active // false),
            (.metadata.name // ""),
            ((.metadata.externalRefs // []) | length)
          ]
        | @tsv')

    local n_write=${#PLAN_WRITE[@]}
    local n_skip=${#PLAN_SKIP[@]}
    local n_miss=${#PLAN_MISS[@]}

    if [[ "$JSON_OUT" -eq 1 ]]; then
        local write_json skip_json miss_json
        write_json="$(printf '%s\n' "${PLAN_WRITE[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"
        skip_json="$(printf '%s\n' "${PLAN_SKIP[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"
        miss_json="$(printf '%s\n' "${PLAN_MISS[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"
        jq -cn \
            --arg mode "$mode" \
            --argjson write "$write_json" \
            --argjson skip "$skip_json" \
            --argjson miss "$miss_json" \
            '{mode:$mode,write:$write,skip:$skip,unresolved:$miss}'
        return 0
    fi

    (( n_write > 0 )) && _print_section "WRITE (inferred primary refs):" "${PLAN_WRITE[@]}"
    (( n_skip > 0 )) && _print_section "SKIP (already attached):" "${PLAN_SKIP[@]}"
    (( n_miss > 0 )) && _print_section "UNRESOLVED (PR not on upstream or fork):" "${PLAN_MISS[@]}"
    (( n_write == 0 && n_skip == 0 && n_miss == 0 )) && echo "(no PR-titled sessions found)"
    echo ""
    echo "Counts: write=${n_write} skip=${n_skip} unresolved=${n_miss}"
    if [[ "$BACKFILL_APPLY" -eq 0 ]]; then
        echo "No hub writes. Re-run with: hapi-meta-daily.sh --backfill-refs --apply"
    else
        echo "Hub PUTs attempted for WRITE rows (see errors above if any)."
    fi
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

# md_session_prs <title> → space-joined PR/Peer numbers (dedup order preserved)
# LEGACY helper for unit tests / --backfill-refs adjacent tooling.
# Daily Meta discovery does NOT call this — chips only (2026-08-06).
md_session_prs() {
    pec_extract_pr_numbers "$1" | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/ *$//'
}

# md_session_linked_prs <title> → space-joined numbers from explicit PR # markers only.
# For --backfill-refs / chip identity. Never Peer #N or bare #N (those are issues).
md_session_linked_prs() {
    pec_extract_linked_pr_numbers "$1" | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/ *$//'
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

# md_plan_ping <new_emoji> <new_fp> <prev_emoji> <prev_fp> <prev_ping> <now> <reminder> [window_rouse]
#   → "yes"/"no" (wraps pec_should_ping; kept for test clarity)
md_plan_ping() {
    pec_should_ping "$1" "$3" "$2" "$4" "${5:-0}" "$6" "$7" "${8:-0}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    if [[ "$BACKFILL_REFS" -eq 1 ]]; then
        md_backfill_refs
        return 0
    fi

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
    # Promote blank metadata.name → display title (summary.text / path basename).
    # Empty name is common (agent change_title writes summary only — see #271) but
    # hollow name fields break Meta TSV-era ownership and confuse chip tooling.
    # NDJSON discovery is fixed; this heal keeps name non-blank going forward.
    sessions_json="$(hub_heal_blank_names "$jwt" "$sessions_json")"

    # --- discovery: PR numbers from session chips ONLY (never titles) ---
    # HARD RULE (2026-08-06 Sparling): session titles are decorative. Meta tracks a
    # session iff metadata.externalRefs has github_pr on tiann/hapi | heavygee/hapi.
    # Linked → hapi or not. Unlinked → invisible to Meta. No Peer/PR/# title scrape.
    declare -A SESS_ID SESS_ACTIVE SESS_NAME SESS_PRS SESS_REFS SESS_PATH SESS_LIFECYCLE
    declare -A PR_SESSIONS      # pr -> "sid8,sid8"
    declare -A ALL_PR           # pr -> 1
    declare -A MERGED_TITLE

    # NDJSON rows — NOT @tsv. Bash IFS=$'\t' collapses consecutive tabs, so an
    # empty metadata.name shifts fields and Meta drops ownership (estate: #1383
    # Storage Display sat orphan/`stale` while the chip was linked 2026-08-06..07).
    local row sid sid8 active name prs refs_json path lifecycle
    while IFS= read -r row; do
        [[ -z "$row" ]] && continue
        sid="$(jq -r '.[0] // empty' <<<"$row")"
        [[ -z "$sid" ]] && continue
        active="$(jq -r '.[1] // false' <<<"$row")"
        name="$(jq -r '.[2] // ""' <<<"$row")"
        refs_json="$(jq -c '.[3] // []' <<<"$row")"
        path="$(jq -r '.[4] // ""' <<<"$row")"
        lifecycle="$(jq -r '.[5] // ""' <<<"$row")"

        local hapi_refs=""
        hapi_refs="$(printf '%s' "${refs_json:-[]}" | jq -r '
            [.[]
             | select(.kind == "github_pr")
             | select((.repo // "") == "tiann/hapi" or (.repo // "") == "heavygee/hapi")
             | .number]
            | unique | map(tostring) | join(" ")
        ' 2>/dev/null || true)"
        [[ -z "$hapi_refs" ]] && continue

        prs="$hapi_refs"
        sid8="${sid:0:8}"
        SESS_ID["$sid8"]="$sid"
        SESS_ACTIVE["$sid8"]="$active"
        SESS_NAME["$sid8"]="$name"
        SESS_PRS["$sid8"]="$prs"
        SESS_REFS["$sid8"]="${refs_json:-[]}"
        SESS_PATH["$sid8"]="${path:-}"
        SESS_LIFECYCLE["$sid8"]="${lifecycle:-}"
        local p
        for p in $prs; do
            ALL_PR["$p"]=1
            PR_SESSIONS["$p"]="${PR_SESSIONS[$p]:+${PR_SESSIONS[$p]},}$sid8"
        done
    done < <(printf '%s' "$sessions_json" | jq -c '
        .[]
        | select(
            ((.metadata.externalRefs // [])
             | map(select(.kind == "github_pr"
                          and ((.repo // "") == "tiann/hapi"
                               or (.repo // "") == "heavygee/hapi")))
             | length) > 0
          )
        | [
            .id,
            (.active // false),
            (.metadata.name // ""),
            (.metadata.externalRefs // []),
            (.metadata.path // ""),
            (.metadata.lifecycleState // "")
          ]')
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

    declare -A PR_EMOJI PR_ACTION PR_PREPR PR_HEADREF
    declare -A SESS_PR_EMOJI SESS_PR_ACTION
    for p in "${pr_list[@]}"; do
        PR_EMOJI["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].emoji // "?"')"
        PR_ACTION["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].action // ""')"
        PR_PREPR["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].prePr // false')"
        PR_HEADREF["$p"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].headRef // ""')"
    done

    # Manifest once for 🧹 complete promotion (same path as wave-clear).
    local manifest_path_early manifest_text_early
    manifest_path_early="${HAPI_META_MANIFEST:-$(hapi_manifest_path "$HAPI_PRIMARY")}"
    if [[ -f "$manifest_path_early" ]]; then
        manifest_text_early="$(cat "$manifest_path_early")"
    else
        manifest_text_early=""
    fi

    # --- per-session: rename + policy ping; build next state ---
    local new_state="$state"
    local -a Q_WARN Q_MERGED Q_COMPLETE Q_ORPHAN Q_INACTIVE Q_PINGED Q_RENAMED Q_STATUS Q_WAIT_TIANN Q_SELF_MERGE
    local -a PLAN_ROWS   # for --json
    MD_EMIT_FAILURES=0
    local now_ms=$(( now * 1000 ))

    local sid8
    for sid8 in "${!SESS_ID[@]}"; do
        sid="${SESS_ID[$sid8]}"
        name="${SESS_NAME[$sid8]}"
        active="${SESS_ACTIVE[$sid8]}"
        prs="${SESS_PRS[$sid8]}"
        # --pr N only classifies N; skip sessions that do not reference it.
        # Without this, set -u dies on PR_EMOJI[$other] for every other chipped session.
        if [[ -n "$PR_ONLY" ]]; then
            local hit_pr=0
            for p in $prs; do
                [[ "$p" == "$PR_ONLY" ]] && hit_pr=1 && break
            done
            [[ "$hit_pr" -eq 1 ]] || continue
        fi
        local emojis=() acts="" combined pre=0 first_pr=""
        for p in $prs; do
            # Per-session 🔧→🧹 when estate complete predicates hold (config/pr-chip-states.yaml).
            local emoji_sess="${PR_EMOJI[$p]:-?}"
            local action_sess="${PR_ACTION[$p]:-}"
            if [[ "$emoji_sess" == "🔧" ]]; then
                local complete_reason=""
                if complete_reason="$(mw_member_complete \
                    "$manifest_text_early" \
                    "${SESS_PATH[$sid8]:-}" \
                    "$p" \
                    "${SESS_LIFECYCLE[$sid8]:-}" \
                    "$HAPI_PRIMARY" \
                    "${PR_HEADREF[$p]:-}")"; then
                    emoji_sess="🧹"
                    action_sess="fully cleaned — babysit ended"
                else
                    vlog "complete? #$p [$sid8] → $complete_reason"
                fi
            fi
            emojis+=("$emoji_sess")
            [[ -z "$first_pr" ]] && first_pr="$p"
            [[ -n "$action_sess" ]] && acts+="#$p: $action_sess"$'\n'
            # Stash per-session emoji for chip write (may differ from PR_EMOJI global).
            SESS_PR_EMOJI["$sid8:$p"]="$emoji_sess"
            SESS_PR_ACTION["$sid8:$p"]="$action_sess"
        done
        combined="$(md_combined_emoji "${emojis[@]}")"
        [[ -z "$combined" ]] && combined="?"

        # Chip status cache on externalRefs (ADR D8). Skip "?" to preserve last good.
        local refs_cur refs_next changed_status=0 has_chip=0
        refs_cur="${SESS_REFS[$sid8]:-[]}"
        refs_next="$refs_cur"
        if [[ -n "$refs_cur" && "$refs_cur" != "[]" && "$refs_cur" != "null" ]]; then
            if printf '%s' "$refs_cur" | jq -e '[.[] | select(.kind == "github_pr")] | length > 0' >/dev/null 2>&1; then
                has_chip=1
            fi
        fi

        # Title policy (ADR D8+): chip owns PR identity + health.
        # Chipped sessions → strip leading status emoji AND "PR #N:" prefixes once;
        # never write emoji or PR-number prefixes into titles.
        # Unchipped sessions → leave title alone (do not invent ✅/PR # prefixes).
        # "Peer #N:" incubating titles are kept (no issue chip yet).
        local new_title="$name"
        if [[ "$has_chip" -eq 1 ]]; then
            new_title="$(pec_strip_pr_number_prefixes "$name")"
            if [[ -n "$new_title" && "$new_title" != "$name" ]]; then
                hub_rename "$jwt" "$sid" "$new_title"
                Q_RENAMED+=("$sid8  $name  →  $new_title  [chip owns identity]")
            fi
        fi
        if [[ "$refs_cur" != "[]" && "$refs_cur" != "null" && -n "$refs_cur" ]]; then
            local p emoji_p action_p patched
            for p in $prs; do
                emoji_p="${SESS_PR_EMOJI[$sid8:$p]:-${PR_EMOJI[$p]:-?}}"
                action_p="${SESS_PR_ACTION[$sid8:$p]:-${PR_ACTION[$p]:-}}"
                if patched="$(md_refs_apply_status "$refs_next" "$p" "$emoji_p" "$action_p" "$now_ms")"; then
                    refs_next="$patched"
                    changed_status=1
                fi
            done
            if [[ "$changed_status" -eq 1 ]]; then
                hub_put_external_refs "$jwt" "$sid" "$refs_next" || true
                SESS_REFS["$sid8"]="$refs_next"
                Q_STATUS+=("$sid8  →  $combined  #$(echo "$prs" | tr ' ' ',')")
            fi
        fi

        # ping policy (actuator cursor: emoji/fp/last_ping)
        # Ping windows (DO_PING=1): force-rouse sticky ⚠️/🔧 ("are you done yet?").
        # Quiet --no-ping refresh: never pings; emit still uses non-window policy.
        local action_fp prev_emoji prev_fp prev_ping decision window_rouse=0
        [[ "$DO_PING" -eq 1 ]] && window_rouse=1
        action_fp="$(pec_action_fingerprint "$combined" "$acts")"
        prev_emoji="$(md_prev "$state" "$sid" "emoji")"
        prev_fp="$(md_prev "$state" "$sid" "fp")"
        prev_ping="$(md_prev "$state" "$sid" "last_ping")"
        [[ -z "$prev_ping" ]] && prev_ping=0
        # md_plan_ping/pec_should_ping return 1 for "no"; capture text, ignore rc.
        decision="$(md_plan_ping "$combined" "$action_fp" "$prev_emoji" "$prev_fp" "$prev_ping" "$now" "$REMINDER_SECS" "$window_rouse" || true)"

        local this_ping="$prev_ping"
        if [[ "$combined" == "?" ]]; then
            : # unknown: leave everything, don't touch state emoji
        else
            if [[ "$decision" == "yes" && "$DO_PING" -eq 1 ]]; then
                # A+C: always deliver for work states. hapi-ping-peer resumes
                # inactive sessions — do not skip asleep ⚠️/🔧 (that was the
                # last_ping=0 dead zone).
                local ping_note=""
                if [[ "$active" != "true" ]]; then
                    ping_note=" [resume]"
                    if [[ "$combined" != "⚠️" && "$combined" != "🔧" ]]; then
                        # Non-work sticky (shouldn't happen often): keep old inactive list
                        Q_INACTIVE+=("$sid8  $combined  #$(echo "$prs" | tr ' ' ',')  — inactive; run: hapi-ping-peer $sid8 \"…\"")
                        ping_note="skip"
                    fi
                fi
                if [[ "$ping_note" != "skip" ]]; then
                    _do_ping "$sid8" "$combined" "$prs" "$acts"
                    Q_PINGED+=("$sid8  $combined  #$(echo "$prs" | tr ' ' ',')${ping_note}")
                    this_ping="$now"
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
                emit_reason="$(pec_emit_reason "$combined" "$prev_emitted_e" "$action_fp" "$prev_emitted_fp" "$prev_emitted_at" "$now" "$REMINDER_SECS" "$window_rouse" || true)"
                if [[ "$emit_reason" != "none" && -n "$emit_reason" ]]; then
                    local emit_date emit_pr emit_body
                    # Window emits key by London hour so 3 daily windows don't collide.
                    if [[ "$emit_reason" == "window" ]]; then
                        emit_date="$(TZ=Europe/London date +%Y-%m-%dT%H)"
                    else
                        emit_date="$(date -u +%Y-%m-%d)"
                    fi
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
            🔧) Q_MERGED+=("#$(echo "$prs" | tr ' ' ',') [$sid8] MERGED - peer: drop soup layer, clean worktree/branch, archive") ;;
            🧹) Q_COMPLETE+=("#$(echo "$prs" | tr ' ' ',') [$sid8] COMPLETE - babysit ended (no ping)") ;;
            ✅)
                # Lane overlay: self-merge eligible vs wait on tiann (chip stays ✅).
                if printf '%s' "$acts" | grep -q 'self-merge eligible'; then
                    Q_SELF_MERGE+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')")
                else
                    Q_WAIT_TIANN+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')")
                fi
                ;;
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

    # --- wave-clear (gate A): owned 🔧 only; orphans never block ---
    local -a Q_WAVE
    local WAVE_UNLOCK=0 WAVE_DEFER="" WAVE_ID=""
    local manifest_path manifest_text members_json wave_adv prev_wave
    manifest_path="${HAPI_META_MANIFEST:-$(hapi_manifest_path "$HAPI_PRIMARY")}"
    if [[ -f "$manifest_path" ]]; then
        manifest_text="$(cat "$manifest_path")"
    else
        manifest_text=""
        vlog "wave: manifest missing at $manifest_path — treating layers as clean"
    fi
    members_json='[]'
    for sid8 in "${!SESS_ID[@]}"; do
        prs="${SESS_PRS[$sid8]}"
        local emojis_w=() combined_w
        for p in $prs; do
            emojis_w+=("${PR_EMOJI[$p]:-?}")
        done
        combined_w="$(md_combined_emoji "${emojis_w[@]}")"
        [[ "$combined_w" == "🔧" ]] || continue
        # One member row per PR on this session that is merged.
        for p in $prs; do
            [[ "${PR_EMOJI[$p]:-}" == "🔧" ]] || continue
            local reason_w clean_json=false
            if reason_w="$(mw_wave_member_clean "$manifest_text" "${SESS_PATH[$sid8]:-}" "$p")"; then
                clean_json=true
            else
                Q_WAVE+=("#$p [$sid8] still dirty ($reason_w)")
            fi
            members_json="$(printf '%s' "$members_json" | jq -c \
                --argjson pr "$p" \
                --arg sid "${SESS_ID[$sid8]}" \
                --argjson clean "$clean_json" \
                --arg path "${SESS_PATH[$sid8]:-}" \
                --arg reason "${reason_w:-clean}" \
                '. + [{pr:$pr, sid:$sid, clean:$clean, path:$path, reason:$reason}]')"
        done
    done
    prev_wave="$(printf '%s' "$state" | jq -c '.wave // {status:"idle"}')"
    local busy_01=0
    if mw_driver_stack_busy; then busy_01=1; fi
    local collect_secs="${HAPI_META_WAVE_COLLECT_SECS:-1800}"
    wave_adv="$(mw_advance_wave "$prev_wave" "$members_json" "$now" "$collect_secs" "$busy_01" "$DO_PING")"
    new_state="$(printf '%s' "$new_state" | jq -c --argjson w "$(printf '%s' "$wave_adv" | jq -c '.wave')" '.wave = $w')"
    WAVE_ID="$(printf '%s' "$wave_adv" | jq -r '.wave.id')"
    WAVE_DEFER="$(printf '%s' "$wave_adv" | jq -r '.defer_reason // empty')"
    local emit_collect emit_ready do_unlock
    emit_collect="$(printf '%s' "$wave_adv" | jq -r '.emit_collect')"
    emit_ready="$(printf '%s' "$wave_adv" | jq -r '.emit_ready')"
    do_unlock="$(printf '%s' "$wave_adv" | jq -r '.unlock')"
    local prs_csv tooling_sid
    prs_csv="$(printf '%s' "$members_json" | jq -r '[.[].pr] | unique | sort | map(tostring) | join(",")')"
    tooling_sid="${HAPI_META_TOOLING_SESSION_ID:-}"

    if [[ "$EMIT_EVENTS" -eq 1 ]]; then
        local wave_date wave_body wave_kind=""
        wave_date="$(date -u +%Y-%m-%d)"
        if [[ "$emit_collect" == "true" ]]; then wave_kind="collect"; fi
        if [[ "$emit_ready" == "true" ]]; then wave_kind="ready"; fi
        if [[ -n "$wave_kind" ]]; then
            wave_body="$(mw_build_wave_event_body \
                --repo "$UPSTREAM_REPO" \
                --wave-id "$WAVE_ID" \
                --prs-csv "$prs_csv" \
                --kind "$wave_kind" \
                --session-id "$tooling_sid" \
                --date "$wave_date")"
            if hub_emit_event "$jwt" "$wave_body"; then
                vlog "emit-events wave $WAVE_ID kind=$wave_kind"
            else
                MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
            fi
        fi
    fi

    if [[ "$do_unlock" == "true" ]]; then
        if [[ -n "$tooling_sid" ]]; then
            _do_wave_unlock_ping "$tooling_sid" "$WAVE_ID" "$prs_csv"
            WAVE_UNLOCK=1
            Q_WAVE+=("UNLOCK → Meta tooling $tooling_sid (wave $WAVE_ID PRs $prs_csv)")
        else
            WAVE_DEFER="no_tooling_session"
            Q_WAVE+=("READY wave $WAVE_ID (PRs $prs_csv) — set HAPI_META_TOOLING_SESSION_ID to unlock-ping")
            # Stay ready (not dispatched) so next ping window can unlock.
            new_state="$(printf '%s' "$new_state" | jq -c '.wave.status = "ready"')"
        fi
    elif [[ -n "$WAVE_DEFER" && "$WAVE_DEFER" != "no_owned_merged" && "$WAVE_DEFER" != "already_dispatched" ]]; then
        Q_WAVE+=("wave $WAVE_ID deferred: $WAVE_DEFER")
    fi

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
        --url "${url:-https://github.com/${repo}/pull/${pr}}")"
    hub_emit_event "$jwt" "$body" || {
        MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
        return 1
    }
    new_state="$(printf '%s' "$new_state" | jq -c --arg k "$seen_key" \
        '.notif_seen = ((.notif_seen // {}) + {($k): true})')"
}

# _do_wave_unlock_ping <session_id_or_prefix> <wave_id> <prs_csv> <busy_01>
_do_wave_unlock_ping() {
    local sid="$1" wid="$2" prs_csv="$3"
    local msg="Meta daily — WAVE CLEAR unlock (${wid}).

Owned merged PR(s) cleaned (gate A: soup layer gone + worktree gone): #${prs_csv//,/, #}

You MAY rematerialize without waiting for further operator approval:
1. \`hapi-driver-status --quiet\` (exit 0 idle; 75 = rebuild/switch already in progress — wait)
2. \`hapi-sync-fork-main && git push origin main\` (if fork main behind upstream)
3. \`hapi-driver-rebuild --build-web --verify\`
4. \`hapi-verify-web-dist\` + \`hapi-restart-hub\` if hub/cli changed
5. Archive idle 🔧 peer sessions from outside once soup is fresh

Manual mid-window rebuilds are expected — if status is busy, wait and retry; do not force a second rebuild on top.
Canon: docs/operator/AGENTS.md § Meta PR watcher + feature-work-lifecycle.md § After upstream merge"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] wave-unlock ping $sid ($wid)" >&2
        return 0
    fi
    "$PING_BIN" "$sid" "$msg" >/dev/null 2>&1 || err "wave-unlock ping failed for $sid"
}

_do_ping() {  # <sid8> <emoji> <prs> <acts>
    local sid8="$1" emoji="$2" prs="$3" acts="$4"
    local sess_path="${SESS_PATH[$sid8]:-}"
    # HARD refuse (2026-08-06 Sparling): never Meta-ping a foreign-path session
    # unless it already carries a tiann/heavygee hapi github_pr chip (real HAPI work
    # with a weird cwd, e.g. gate-A fixtures). Title-only scrapes on Sparling die
    # earlier at classify; this is defense in depth for 🔧 cleanup pings.
    if [[ -n "$sess_path" ]] && ! pec_path_is_hapi_estate "$sess_path"; then
        local has_hapi_chip=0
        if printf '%s' "${SESS_REFS[$sid8]:-[]}" | jq -e '
            [.[]
             | select(.kind == "github_pr")
             | select((.repo // "") == "tiann/hapi" or (.repo // "") == "heavygee/hapi")]
            | length > 0
        ' >/dev/null 2>&1; then
            has_hapi_chip=1
        fi
        if [[ "$has_hapi_chip" -eq 0 ]]; then
            err "REFUSE ping $sid8: path outside HAPI estate and no hapi github_pr chip ($sess_path)"
            return 0
        fi
    fi
    local state_desc rouse=""
    case "$emoji" in
        ✅)
            if printf '%s' "$acts" | grep -q 'self-merge eligible'; then
                state_desc="open PR green - self-merge eligible (lane B)"
            else
                state_desc="open PR green - wait on tiann (lane A)"
            fi
            ;;
        🔁) state_desc="CI/rebase in flight" ;;
        ⚠️) state_desc="needs work"; rouse=$'\n\n**Meta ping window — are you done yet?** Resume work or reply with the blocker.' ;;
        📝) state_desc="pre-PR - not filed upstream yet" ;;
        🔧) state_desc="MERGED - clean up soup/worktree/branch, archive when idle"; rouse=$'\n\n**Meta ping window — are you done yet?** Drop soup layer + clean worktree/branch, then ack. Do not rematerialize mid-wave. Do not mid-turn self-archive.' ;;
        🧹) state_desc="COMPLETE - fully cleaned; babysit ended"; rouse="" ;;
        *) state_desc="see title" ;;
    esac
    local msg="Meta daily — PR status is now **${emoji}** (${state_desc}).${rouse}

Tracked PR(s): #$(echo "$prs" | tr ' ' ',')

${acts}
Status lives on the **session PR chip** (\`externalRefs.status\`), not in the title. Do **not** put ✅/🔁/⚠️/📝/🔧/🧹 in your session title; leave the title as workstream-only. If the chip is missing, run \`hapi link-pr <url>\` (or MCP \`link_pr\`) with awareness on.
Legend: ✅ green (lane A wait / lane B self-merge) · 🔁 CI in flight · ⚠️ fix threads/CI/rebase · 📝 pre-PR · 🔧 merged (cleanup owed) · 🧹 complete (babysit ended — no further Meta pings).
Canon: docs/operator/AGENTS.md § Meta PR watcher + feature-work-lifecycle.md § Session titles and PR chips"
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
    _print_section "🧹  COMPLETE — babysit ended:" "${Q_COMPLETE[@]:-}"
    _print_section "🌊 WAVE CLEAR (gate A — owned only; orphans never block):" "${Q_WAVE[@]:-}"
    _print_section "❓ ORPHANS (anomaly — do not block wave-clear):" "${Q_ORPHAN[@]:-}"
    _print_section "😴 INACTIVE (policy wanted a ping; session asleep):" "${Q_INACTIVE[@]:-}"
    _print_section "📨 NEW GITHUB COMMS since last run:" "${Q_NOTIF[@]:-}"
    _print_section "✅ RENAMED this run:" "${Q_RENAMED[@]:-}"
    _print_section "🏷️  CHIP STATUS updated (externalRefs cache):" "${Q_STATUS[@]:-}"
    _print_section "📣 PINGED this run:" "${Q_PINGED[@]:-}"
    _print_section "🟢 WAIT TIANN (✅ green, lane A - maintainer merge):" "${Q_WAIT_TIANN[@]:-}"
    _print_section "🟣 SELF-MERGE ELIGIBLE (✅ green, lane B - operator/Meta may merge):" "${Q_SELF_MERGE[@]:-}"
    echo ""
    echo "NEXT STEPS:"
    echo "  - Lane A (WAIT TIANN): prepare only; @tiann merges. Agents never gh pr merge."
    echo "  - Lane B (SELF-MERGE): tests/docs auto or low-impact/allowlist promote."
    echo "    Operator/Meta may merge quietly (no blessing essays on the PR)."
    echo "    Agents still prepare-only (no auto merge yet)."
    echo "    Policy: ~/.hapi/pr-merge-policy.json (example: scripts/tooling/pr-merge-policy.example.json)."
    echo "  - Wave-clear unlock pings Meta tooling (HAPI_META_TOOLING_SESSION_ID) on"
    echo "    ping windows only; CLI never runs hapi-driver-rebuild itself."
    echo "  - Manual soup rebuilds outside windows are fine — unlock defers while"
    echo "    hapi-driver-status --quiet reports busy (exit 75)."
    echo "  - Archive idle 🔧 sessions from outside once soup is fresh."
    if [[ "${WAVE_UNLOCK:-0}" -eq 1 ]]; then
        echo "  - This run: WAVE UNLOCK dispatched (wave ${WAVE_ID:-?})."
    elif [[ -n "${WAVE_DEFER:-}" ]]; then
        echo "  - This run: wave defer=${WAVE_DEFER}."
    fi
}

# Only run main when executed, not when sourced by the test.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
    exit $?
fi
