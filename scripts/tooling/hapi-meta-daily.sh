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
#      (ping windows: always rouse sticky ⚠️/🔧 incl. inactive/archived resume;
#      SKIP if session.thinking — already in a turn / emitting (not merely active).
#      🧹 complete never pings; 🔧 Gate A clean / archive-pending never hourly
#      resume — that undoes archive → 🔧 forever; 2026-08-11 e4d152f3)
#      transition / fingerprint / reminder for greens)
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
#   HAPI_META_SESSION_ID — Meta PR watcher full UUID (hourly ping SOURCE for #1203)
#   HAPI_META_SESSION_NAME — optional chip name (default "meta - PR watcher")
#   HAPI_META_TOOLING_SESSION_ID — Meta tooling bot session (unlock ping target)
#   HAPI_META_WAVE_COLLECT_SECS (default 1800) — inbox collect fuse
#   HAPI_META_MANIFEST — manifest path override (tests)
#   HAPI_META_DRIVER_STATUS_BIN — hapi-driver-status override (tests)
# Install/upgrade gh: scripts/tooling/install-gh-official.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/pr-emoji-core.sh
source "$SCRIPT_DIR/lib/pr-emoji-core.sh"
# shellcheck source=lib/pr-hold-core.sh
source "$SCRIPT_DIR/lib/pr-hold-core.sh"
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
# Serialize against hold-ack. Must run before argv is shifted. Skip only when
# parent flock already holds THIS lock file (systemd ExecStart); a bare
# "parent is named flock" check would skip while locking a different path
# (HAPI_META_STATE / HAPI_META_LOCK redirect) and race hold-ack.
if [[ "${BASH_SOURCE[0]}" == "${0}" && -z "${HAPI_META_LOCKED:-}" ]]; then
    _md_lock="${HAPI_META_LOCK:-$(dirname "$STATE_FILE")/meta-daily.lock}"
    _md_parent_comm="$(ps -o comm= -p "${PPID:-0}" 2>/dev/null || true)"
    _md_parent_comm="${_md_parent_comm##*/}"
    _md_skip_lock=0
    if [[ "$_md_parent_comm" == "flock" ]]; then
        _md_parent_args="$(ps -o args= -p "${PPID:-0}" 2>/dev/null || true)"
        # Token match so a shorter path cannot substring-spoof the lock.
        if [[ " ${_md_parent_args} " == *" ${_md_lock} "* ]]; then
            _md_skip_lock=1
        fi
    fi
    if [[ "$_md_skip_lock" -eq 0 ]]; then
        mkdir -p "$(dirname "$_md_lock")"
        export HAPI_META_LOCKED=1
        exec flock -w 600 "$_md_lock" "$0" "$@"
    fi
fi
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

# Timer pings are outside a wrapped session (no peer-deliver broker). Stamp
# them as Meta via hub HMAC (#1203) so recipients see a verified chip, not
# "unknown peer". Unlock target (HAPI_META_TOOLING_SESSION_ID) is the
# destination of wave-clear, not the sender.
if [[ -n "${HAPI_META_SESSION_ID:-}" ]]; then
    export HAPI_SESSION_ID="$HAPI_META_SESSION_ID"
    export HAPI_SESSION_NAME="${HAPI_META_SESSION_NAME:-meta - PR watcher}"
    export HAPI_ESTATE_PEER_ATTRIBUTE=1
elif [[ "$DO_PING" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
    err "WARNING: HAPI_META_SESSION_ID unset — peer pings will be unattributed (unknown peer chip)"
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
        '{schema:1,last_run:null,notif_cursor:{($up):null,($fork):null},sessions:{},orphan_prs:{},notif_seen:{},hold:{},wave:{status:"idle",id:"w-empty",members:[],collect_started_at:null,collect_deadline_at:null}}'
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
    # Writes metadata.name only (manual/Meta rename lane). Do not use this to
    # "fill in" blank names from summary — see md_session_display_title.
    [[ "$DRY_RUN" -eq 1 ]] && { echo "    [dry-run] rename → \"$3\"" >&2; return 0; }
    "$CURL_BIN" -sS --max-time 10 -X PATCH -H "Authorization: Bearer $1" \
        -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg n "$3" '{name:$n}')" \
        "$HAPI_HOST/api/sessions/$2" | jq -e '.ok == true' >/dev/null \
        || err "rename failed for ${2:0:8}"
}

# ---------------------------------------------------------------------------
# Session titles (upstream HAPI, not fork-local)
#
# Two fields, different jobs:
#   metadata.name          — operator / Meta / UI rename (PATCH). Often EMPTY.
#   metadata.summary.text  — agent title via change_title / native title sync.
#
# Agents call change_title → CLI emits a summary message → hub stores
# summary.text only. That is intentional (#271). Empty name + filled summary
# is normal, not data loss.
#
# UI (web/src/lib/sessionTitle.ts getSessionTitle):
#   name → summary.text → path basename → id prefix
#
# Meta must mirror that for labels (SESS_NAME / --json plan.title / strip
# prefixes). Ownership is NEVER by title — only metadata.externalRefs
# github_pr chips (Sparling 2026-08-06).
#
# Anti-pattern (reverted 2026-08-07): hourly PATCH healing blank name ← summary.
# That fought upstream design and hid the real bug (Meta @tsv + empty name
# shifted columns; fixed by NDJSON). If you are tempted to "fix empty name"
# again, fall back in the reader instead.
# ---------------------------------------------------------------------------
md_session_display_title() {
    jq -r '
        . as $o
        | ($o.metadata.name // "" | gsub("^\\s+|\\s+$";"")) as $n
        | if ($n | length) > 0 then $n
          else
            ($o.metadata.summary.text // "" | gsub("^\\s+|\\s+$";"")) as $s
            | if ($s | length) > 0 then $s
              else
                ($o.metadata.path // "" | split("/") | map(select(length>0)) | last // "")
              end
          end
    ' <<<"$1"
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
                       elif $emoji == "🛑" then {}
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

# md_plan_ping <new_emoji> <new_fp> <prev_emoji> <prev_fp> <prev_ping> <now> <reminder> [window_rouse] [sticky_ping]
#   → "yes"/"no" (wraps pec_should_ping; kept for test clarity)
md_plan_ping() {
    pec_should_ping "$1" "$3" "$2" "$4" "${5:-0}" "$6" "$7" "${8:-0}" "${9:-}"
}

# md_session_sticky_peer_ping <sid8> <prs-space-joined>
# true if any ⚠️/🔧 contribution has stickyPing=true (actionable work).
# blockedUpstream-only sessions return false (#128).
# 🔧 merged-cleanup always restores normal policy even when combined emoji is
# ⚠️ (pec_worst_emoji ranks ⚠️ above 🔧) — do not skip non-⚠️ rows (#128 edge).
md_session_sticky_peer_ping() {
    local sid8="$1" prs="$2" p e sticky
    for p in $prs; do
        e="${SESS_PR_EMOJI[$sid8:$p]:-}"
        case "$e" in
            🔧)
                return 0
                ;;
            ⚠️)
                sticky="${SESS_PR_STICKY[$sid8:$p]:-}"
                if [[ -z "$sticky" ]]; then
                    sticky="$(pec_default_sticky_ping "$e" 0)"
                fi
                [[ "$sticky" == "true" ]] && return 0
                ;;
        esac
    done
    return 1
}

# Hold-login CSV: env HAPI_PR_HOLD_LOGINS, else ~/.hapi/pr-hold.json, else tiann.
md_hold_logins() {
    local cfg="${HAPI_PR_HOLD_CONFIG:-$HOME/.hapi/pr-hold.json}" file_json=""
    if [[ -f "$cfg" ]]; then
        file_json="$(cat "$cfg" 2>/dev/null || true)"
    fi
    pec_hold_logins_csv "${HAPI_PR_HOLD_LOGINS:-}" "$file_json"
}

# md_hold_events_json <repo> <number> → JSON array of
# {id,login,type,surface,body,url,created_at}
# Flatten gh --paginate --slurp (array-of-pages) or a single page array.
md_hold_flatten_pages() {
    jq -c 'if type == "array" then
            if length == 0 then .
            elif (.[0] | type) == "array" then add
            else .
            end
          else [] end' 2>/dev/null || echo '[]'
}

md_hold_events_json() {
    local repo="$1" number="$2" comments reviews
    comments="$("$GH_BIN" api --paginate --slurp "repos/${repo}/issues/${number}/comments?per_page=100" 2>/dev/null | md_hold_flatten_pages || true)"
    reviews="$("$GH_BIN" api --paginate --slurp "repos/${repo}/pulls/${number}/reviews?per_page=100" 2>/dev/null | md_hold_flatten_pages || true)"
    [[ -n "$comments" ]] || comments='[]'
    [[ -n "$reviews" ]] || reviews='[]'
    printf '%s\n%s\n' "$comments" "$reviews" | jq -s '
        (.[0] // []) as $c | (.[1] // []) as $r
        | [
            ($c[]? | {
                id: (.id | tostring),
                login: (.user.login // ""),
                type: (.user.type // "User"),
                surface: "issue_comment",
                body: (.body // ""),
                url: (.html_url // ""),
                created_at: (.created_at // "")
            }),
            ($r[]? | {
                id: (.id | tostring),
                login: (.user.login // ""),
                type: (.user.type // "User"),
                surface: "review_body",
                body: (.body // ""),
                url: (.html_url // ""),
                created_at: (.submitted_at // .created_at // "")
            })
          ]
        | sort_by(.created_at)
    ' 2>/dev/null || echo '[]'
}

# md_hold_ingest <state_json> <repo> <number> <logins_csv>
# Prints updated state. Latches the newest qualifying event if new fingerprint.
md_hold_ingest() {
    local state="$1" repo="$2" number="$3" csv="$4"
    local events ev_id login type surface body url created_at
    events="$(md_hold_events_json "$repo" "$number")"
    # Walk newest-first; first qualifying new-or-current latch wins.
    while IFS= read -r ev; do
        [[ -z "$ev" || "$ev" == "null" ]] && continue
        surface="$(jq -r '.surface' <<<"$ev")"
        login="$(jq -r '.login' <<<"$ev")"
        type="$(jq -r '.type' <<<"$ev")"
        body="$(jq -r '.body // ""' <<<"$ev")"
        ev_id="$(jq -r '.id' <<<"$ev")"
        url="$(jq -r '.url // ""' <<<"$ev")"
        created_at="$(jq -r '.created_at // ""' <<<"$ev")"
        pec_hold_should_latch "$surface" "$login" "$type" "$body" "$csv" || continue
        if pec_hold_is_new_latch "$state" "$repo" "$number" "$surface" "$ev_id" "$created_at"; then
            local next
            next="$(pec_hold_upsert_state "$state" "$repo" "$number" "$surface" "$ev_id" "$login" "$url" "$body" "$created_at" || true)"
            if [[ -n "$next" ]] && printf '%s' "$next" | jq -e . >/dev/null 2>&1; then
                printf '%s' "$next"
            else
                err "hold upsert failed for ${repo}#${number}; keeping prior state"
                printf '%s' "$state"
            fi
            return 0
        fi
        # Not a new latch. If this exact fingerprint is the current *unacked*
        # hold, keep the row and stop. If it was already acknowledged (or is an
        # older/equal non-matching event), keep scanning so a same-second
        # sibling (surface,id) can still reach pec_hold_is_new_latch.
        local key
        key="$(pec_hold_state_key "$repo" "$number")"
        if printf '%s' "$state" | jq -e \
            --arg k "$key" --arg id "$ev_id" --arg surface "$surface" '
            (.hold[$k] | type) == "object"
            and .hold[$k].acked == false
            and (.hold[$k].comment_id // "") == $id
            and (
                (.hold[$k].surface // "") == ""
                or (.hold[$k].surface // "") == $surface
            )
        ' >/dev/null 2>&1; then
            printf '%s' "$state"
            return 0
        fi
        continue
    done < <(printf '%s' "$events" | jq -c 'reverse | .[]' 2>/dev/null || true)
    printf '%s' "$state"
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

    # --- discovery: PR numbers from session chips ONLY (never titles) ---
    # HARD RULE (2026-08-06 Sparling): session titles are decorative. Meta tracks a
    # session iff metadata.externalRefs has github_pr on tiann/hapi | heavygee/hapi.
    # Linked → hapi or not. Unlinked → invisible to Meta. No Peer/PR/# title scrape.
    declare -A SESS_ID SESS_ACTIVE SESS_NAME SESS_PRS SESS_REFS SESS_PATH SESS_LIFECYCLE SESS_THINKING SESS_PR_REPO
    declare -A PR_SESSIONS      # pr -> "sid8,sid8"
    declare -A PAIR_OWNED       # repo#number -> 1 (session chips that exact pair)
    declare -A ALL_PR           # pr -> 1
    declare -A MERGED_TITLE
    declare -A PR_REPO          # pr -> owner/name (from chip; prefer tiann/hapi)
    declare -A UPSTREAM_DISCOVERED  # pr -> 1 (gh open/merged on UPSTREAM_REPO)

    # NDJSON rows — NOT @tsv. Bash IFS=$'\t' collapses consecutive tabs, so an
    # empty metadata.name shifts fields and Meta drops ownership (estate: #1383).
    # Column [2] is md_session_display_title (name → summary → path), not raw
    # metadata.name — see comment block above that helper.
    local row sid sid8 active name prs refs_json path lifecycle thinking
    while IFS= read -r row; do
        [[ -z "$row" ]] && continue
        sid="$(jq -r '.[0] // empty' <<<"$row")"
        [[ -z "$sid" ]] && continue
        active="$(jq -r '.[1] // false' <<<"$row")"
        name="$(jq -r '.[2] // ""' <<<"$row")"
        refs_json="$(jq -c '.[3] // []' <<<"$row")"
        path="$(jq -r '.[4] // ""' <<<"$row")"
        lifecycle="$(jq -r '.[5] // ""' <<<"$row")"
        thinking="$(jq -r '.[6] // false' <<<"$row")"

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
        SESS_THINKING["$sid8"]="${thinking:-false}"
        local p chip_repo
        for p in $prs; do
            ALL_PR["$p"]=1
            PR_SESSIONS["$p"]="${PR_SESSIONS[$p]:+${PR_SESSIONS[$p]},}$sid8"
            chip_repo="$(printf '%s' "${refs_json:-[]}" | jq -r --argjson n "$p" '
                [.[] | select(.kind == "github_pr" and ((.number | tonumber) == $n)) | .repo // empty]
                | first // empty
            ' 2>/dev/null || true)"
            if [[ -n "$chip_repo" ]]; then
                SESS_PR_REPO["$sid8:$p"]="$chip_repo"
                PAIR_OWNED["$chip_repo#$p"]=1
                if [[ "${PR_REPO[$p]:-}" != "$UPSTREAM_REPO" ]]; then
                    PR_REPO["$p"]="$chip_repo"
                fi
            fi
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
        | . as $o
        | (
            ($o.metadata.name // "" | gsub("^\\s+|\\s+$";"")) as $n
            | if ($n | length) > 0 then $n
              else
                ($o.metadata.summary.text // "" | gsub("^\\s+|\\s+$";"")) as $s
                | if ($s | length) > 0 then $s
                  else
                    ($o.metadata.path // "" | split("/") | map(select(length>0)) | last // "")
                  end
              end
          ) as $title
        | [
            $o.id,
            ($o.active // false),
            $title,
            ($o.metadata.externalRefs // []),
            ($o.metadata.path // ""),
            ($o.metadata.lifecycleState // ""),
            ($o.thinking // false)
          ]')
    if [[ -n "$PR_ONLY" ]]; then
        # Restrict to a single explicit PR (allows low-numbered upstream PRs).
        ALL_PR=(["$PR_ONLY"]=1)
    else
        local p
        for p in $(gh_open_pr_numbers); do
            ALL_PR["$p"]=1
            UPSTREAM_DISCOVERED["$p"]=1
        done
        while IFS=$'\t' read -r num title _mergedAt; do
            [[ -z "$num" ]] && continue
            ALL_PR["$num"]=1
            UPSTREAM_DISCOVERED["$num"]=1
            MERGED_TITLE["$num"]="$title"
        done < <(gh_merged_recent "$merged_since")
    fi

    local pr_list=()
    for p in "${!ALL_PR[@]}"; do pr_list+=("$p"); done
    [[ ${#pr_list[@]} -gt 0 ]] || { echo "No tracked PRs / PR-tagged sessions found."; return 0; }
    IFS=$'\n' pr_list=($(sort -n <<<"${pr_list[*]}")); unset IFS

    vlog "classifying ${#pr_list[@]} PR(s): ${pr_list[*]}"
    declare -A PR_EMOJI PR_ACTION PR_PREPR PR_HEADREF PR_EXISTS
    declare -A PR_BY_REPO_EMOJI PR_BY_REPO_ACTION PR_BY_REPO_PREPR PR_BY_REPO_HEADREF PR_BY_REPO_EXISTS
    declare -A PR_BY_REPO_BLOCKED PR_BY_REPO_STICKY
    declare -A SESS_PR_EMOJI SESS_PR_ACTION SESS_PR_STICKY
    # Per (chip.repo, number), not one tiann batch keyed by number. Dual chips
    # heavygee#124 + tiann#124 must keep independent classify results.
    local batch_json r pair_key
    local -a classify_prs
    declare -A REPO_PR_LIST PAIR_SEEN
    md_add_classify_pair() {
        local _r="$1" _n="$2"
        local _k="${_r}#${_n}"
        [[ -n "${PAIR_SEEN[$_k]:-}" ]] && return 0
        PAIR_SEEN["$_k"]=1
        REPO_PR_LIST["$_r"]="${REPO_PR_LIST[$_r]:+${REPO_PR_LIST[$_r]} }$_n"
    }
    local sid8_c
    for sid8_c in "${!SESS_ID[@]}"; do
        local p_c
        for p_c in ${SESS_PRS[$sid8_c]}; do
            if [[ -n "$PR_ONLY" && "$p_c" != "$PR_ONLY" ]]; then
                continue
            fi
            r="${SESS_PR_REPO[$sid8_c:$p_c]:-${PR_REPO[$p_c]:-$UPSTREAM_REPO}}"
            md_add_classify_pair "$r" "$p_c"
        done
    done
    for p in "${pr_list[@]}"; do
        md_add_classify_pair "${PR_REPO[$p]:-$UPSTREAM_REPO}" "$p"
    done
    # Authored open/merged live on UPSTREAM_REPO even when a fork chip already
    # claimed PR_REPO[N]. Number collision must still classify tiann#N.
    for p in "${!UPSTREAM_DISCOVERED[@]}"; do
        if [[ -n "$PR_ONLY" && "$p" != "$PR_ONLY" ]]; then
            continue
        fi
        md_add_classify_pair "$UPSTREAM_REPO" "$p"
    done
    for r in "${!REPO_PR_LIST[@]}"; do
        classify_prs=()
        read -r -a classify_prs <<<"${REPO_PR_LIST[$r]}"
        [[ ${#classify_prs[@]} -gt 0 ]] || continue
        batch_json="$(HAPI_PR_REPO="$r" "$BATCH_BIN" --repo "$r" "${classify_prs[@]}")" \
            || die "batch classify failed for $r"
        for p in "${classify_prs[@]}"; do
            pair_key="$r#$p"
            PR_BY_REPO_EMOJI["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].emoji // "?"')"
            PR_BY_REPO_ACTION["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].action // ""')"
            PR_BY_REPO_PREPR["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].prePr // false')"
            PR_BY_REPO_HEADREF["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].headRef // ""')"
            PR_BY_REPO_EXISTS["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '
                if (.[$p] | has("exists")) then (.[$p].exists | tostring) else "true" end
            ')"
            PR_BY_REPO_BLOCKED["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '.[$p].blockedUpstream // false | tostring')"
            PR_BY_REPO_STICKY["$pair_key"]="$(printf '%s' "$batch_json" | jq -r --arg p "$p" '
                if (.[$p] | has("stickyPing")) then (.[$p].stickyPing | tostring) else empty end
            ')"
            PR_EMOJI["$p"]="${PR_BY_REPO_EMOJI[$pair_key]}"
            PR_ACTION["$p"]="${PR_BY_REPO_ACTION[$pair_key]}"
            PR_PREPR["$p"]="${PR_BY_REPO_PREPR[$pair_key]}"
            PR_HEADREF["$p"]="${PR_BY_REPO_HEADREF[$pair_key]}"
            PR_EXISTS["$p"]="${PR_BY_REPO_EXISTS[$pair_key]}"
        done
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
    local -a Q_WARN Q_MERGED Q_COMPLETE Q_ORPHAN Q_INACTIVE Q_PINGED Q_RENAMED Q_STATUS Q_WAIT_TIANN Q_WAIT_FORK Q_SELF_MERGE Q_SKIP_RUNNING Q_HOLD
    local -a PLAN_ROWS   # for --json
    MD_EMIT_FAILURES=0
    local now_ms=$(( now * 1000 ))

    # Ingest 🛑 from chipped (repo, number) pairs only. PAIR_SEEN also
    # includes authored upstream numbers that collide with a fork chip;
    # PR_SESSIONS is number-only and would ingest the unlinked repo.
    # Skip only when the PR does not exist (true 404 pre-PR). Drafts also
    # set prePr=true (#127) but exists=true — maintainer comments on drafts
    # must still latch 🛑.
    local hold_csv hrepo over hold_action pair_key_h p_h
    hold_csv="$(md_hold_logins)"
    vlog "hold logins: $hold_csv"
    for pair_key_h in "${!PAIR_SEEN[@]}"; do
        hrepo="${pair_key_h%\#*}"
        p_h="${pair_key_h##*\#}"
        [[ -n "${PAIR_OWNED[$pair_key_h]:-}" ]] || continue
        # Explicit false only (fixtures without exists still ingest).
        [[ "${PR_BY_REPO_EXISTS[$pair_key_h]:-true}" == "false" ]] && continue
        new_state="$(md_hold_ingest "$new_state" "$hrepo" "$p_h" "$hold_csv")"
    done

    local sid8
    for sid8 in "${!SESS_ID[@]}"; do
        sid="${SESS_ID[$sid8]}"
        name="${SESS_NAME[$sid8]}"
        active="${SESS_ACTIVE[$sid8]}"
        prs="${SESS_PRS[$sid8]}"
        local prev_emoji_early
        prev_emoji_early="$(md_prev "$state" "$sid" "emoji")"
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
            local crepo="${SESS_PR_REPO[$sid8:$p]:-${PR_REPO[$p]:-$UPSTREAM_REPO}}"
            local pair_sess="$crepo#$p"
            local emoji_sess="${PR_BY_REPO_EMOJI[$pair_sess]:-${PR_EMOJI[$p]:-?}}"
            local action_sess="${PR_BY_REPO_ACTION[$pair_sess]:-${PR_ACTION[$p]:-}}"
            over="$(pec_hold_overlay_emoji "$emoji_sess" "$new_state" "$crepo" "$p")"
            if [[ "$over" == "🛑" ]]; then
                emoji_sess="🛑"
                hold_action="$(pec_hold_action_from_state "$new_state" "$crepo" "$p")"
                [[ -n "$hold_action" ]] && action_sess="$hold_action"
            fi
            if [[ "$emoji_sess" == "🔧" ]]; then
                local complete_reason="" gate_a_reason=""
                if complete_reason="$(mw_member_complete \
                    "$manifest_text_early" \
                    "${SESS_PATH[$sid8]:-}" \
                    "$p" \
                    "${SESS_LIFECYCLE[$sid8]:-}" \
                    "$HAPI_PRIMARY" \
                    "${PR_BY_REPO_HEADREF[$pair_sess]:-${PR_HEADREF[$p]:-}}")"; then
                    emoji_sess="🧹"
                    action_sess="fully cleaned — babysit ended"
                else
                    vlog "complete? #$p [$sid8] → $complete_reason"
                    # Gate A already clean (layer+worktree gone) but archive/branch
                    # still owed — stop nagging "drop soup layer" (#958→#1405 retro).
                    if gate_a_reason="$(mw_wave_member_clean \
                        "$manifest_text_early" \
                        "${SESS_PATH[$sid8]:-}" \
                        "$p")"; then
                        action_sess="Gate A clean — exit reflection (or skip:) then ack + idle; archive pending (Meta archives from outside; do not rematerialize / self-archive mid-turn)"
                        # Latch 🧹: a Meta/peer resume must not demote complete → merged
                        # solely because lifecycle is no longer archived (2026-08-11 e4d152f3).
                        if [[ "$prev_emoji_early" == "🧹" ]]; then
                            emoji_sess="🧹"
                            action_sess="fully cleaned — babysit ended"
                        fi
                    else
                        vlog "gate A dirty #$p [$sid8] → $gate_a_reason"
                    fi
                fi
            fi
            emojis+=("$emoji_sess")
            [[ -z "$first_pr" ]] && first_pr="$p"
            [[ -n "$action_sess" ]] && acts+="#$p: $action_sess"$'\n'
            # Stash per-session emoji for chip write (may differ from PR_EMOJI global).
            SESS_PR_EMOJI["$sid8:$p"]="$emoji_sess"
            SESS_PR_ACTION["$sid8:$p"]="$action_sess"
            # stickyPing: classifier JSON wins; else derive. Hold always false.
            local sticky_sess blocked_sess
            sticky_sess="${PR_BY_REPO_STICKY[$pair_sess]:-}"
            blocked_sess="${PR_BY_REPO_BLOCKED[$pair_sess]:-false}"
            if [[ -z "$sticky_sess" ]]; then
                sticky_sess="$(pec_default_sticky_ping "$emoji_sess" "$blocked_sess")"
            fi
            if [[ "$emoji_sess" == "🛑" ]]; then
                sticky_sess="false"
            fi
            SESS_PR_STICKY["$sid8:$p"]="$sticky_sess"
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
        # blockedUpstream-only sessions: stickyPing=false → no peer ping (#128).
        local action_fp prev_emoji prev_fp prev_ping decision window_rouse=0 session_sticky=true
        [[ "$DO_PING" -eq 1 ]] && window_rouse=1
        if ! md_session_sticky_peer_ping "$sid8" "$prs"; then
            # No actionable sticky ⚠️/🔧 (e.g. only blocked-upstream, or only ✅/📝).
            # Pass sticky=false only when combined is a work emoji that would otherwise nag.
            case "$combined" in
                ⚠️|🔧) session_sticky=false ;;
            esac
        fi
        action_fp="$(pec_action_fingerprint "$combined" "$acts")"
        prev_emoji="$(md_prev "$state" "$sid" "emoji")"
        prev_fp="$(md_prev "$state" "$sid" "fp")"
        prev_ping="$(md_prev "$state" "$sid" "last_ping")"
        [[ -z "$prev_ping" ]] && prev_ping=0
        # md_plan_ping/pec_should_ping return 1 for "no"; capture text, ignore rc.
        decision="$(md_plan_ping "$combined" "$action_fp" "$prev_emoji" "$prev_fp" "$prev_ping" "$now" "$REMINDER_SECS" "$window_rouse" "$session_sticky" || true)"
        # Gate A clean + archive pending is Meta's job. Hourly ping-peer resumes
        # the row, mw_member_complete fails not_archived, chip flips 🧹→🔧, and
        # the next window pings again. Never rouse for that remainder.
        if [[ "$combined" == "🔧" ]] && printf '%s' "$acts" | grep -q 'Gate A clean'; then
            decision="no"
        fi
        # Operator-hold: never hourly-ping (or transition-ping) the coding peer.
        if [[ "$combined" == "🛑" ]]; then
            decision="no"
        fi
        # blocked-upstream-only: chip stays ⚠️ in queue, but never peer-nag (#128).
        if [[ "$session_sticky" == "false" ]]; then
            decision="no"
        fi
        # In-turn skip: session.thinking means the agent is emitting / in a
        # turn (not merely active=true). Injecting "are you done yet?" steers
        # a live turn. Archived/inactive ⚠️ still rouse — chip says work owed.
        local thinking="${SESS_THINKING[$sid8]:-false}"
        if [[ "$thinking" == "true" && "$decision" == "yes" ]]; then
            decision="no"
            Q_SKIP_RUNNING+=("$sid8  $combined  #$(echo "$prs" | tr ' ' ',')  — thinking; skip ping this window")
        fi

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
            # Hold latch notify is independent of --emit-events: hourly timer
            # does not pass that flag (refresh timer is disabled).
            if [[ "$combined" == "🛑" ]]; then
                local emit_date_h emit_body_h emit_repo_h emit_pr_h
                emit_date_h="$(date -u +%Y-%m-%d)"
                for p in $prs; do
                    emit_repo_h="${SESS_PR_REPO[$sid8:$p]:-${PR_REPO[$p]:-$UPSTREAM_REPO}}"
                    if ! printf '%s' "$new_state" | jq -e --arg k "$(pec_hold_state_key "$emit_repo_h" "$p")" \
                        '.hold[$k].acked == false and (.hold[$k].notified != true)' >/dev/null 2>&1; then
                        continue
                    fi
                    emit_pr_h="$p"
                    emit_body_h="$(pec_build_channel_event_body \
                        --repo "$emit_repo_h" \
                        --number "$emit_pr_h" \
                        --emoji "🛑" \
                        --action "${SESS_PR_ACTION[$sid8:$p]:-${PR_ACTION[$p]:-}}" \
                        --fingerprint "$action_fp" \
                        --session-id "$sid" \
                        --reason transition \
                        --date "$emit_date_h")"
                    if hub_emit_event "$jwt" "$emit_body_h"; then
                        new_state="$(printf '%s' "$new_state" | jq -c \
                            --arg s "$sid" --arg e "$combined" --arg f "$action_fp" --argjson le "$now" \
                            '.sessions[$s] = ((.sessions[$s] // {}) + {emitted_emoji:$e, emitted_fp:$f, last_emitted:$le})')"
                        new_state="$(pec_hold_mark_notified "$new_state" "$emit_repo_h" "$p")"
                        vlog "emit-events $sid8 🛑 $emit_repo_h#$p"
                    else
                        MD_EMIT_FAILURES=$((MD_EMIT_FAILURES + 1))
                    fi
                done
            elif [[ "$EMIT_EVENTS" -eq 1 ]]; then
                local emit_reason prev_emitted_e prev_emitted_fp prev_emitted_at
                prev_emitted_e="$(md_prev "$state" "$sid" "emitted_emoji")"
                prev_emitted_fp="$(md_prev "$state" "$sid" "emitted_fp")"
                prev_emitted_at="$(md_prev "$state" "$sid" "last_emitted")"
                [[ -z "$prev_emitted_at" ]] && prev_emitted_at=0
                emit_reason="$(pec_emit_reason "$combined" "$prev_emitted_e" "$action_fp" "$prev_emitted_fp" "$prev_emitted_at" "$now" "$REMINDER_SECS" "$window_rouse" "$session_sticky" || true)"
                if [[ "$session_sticky" == "false" ]]; then
                    # No window/reminder/fingerprint/transition channel nags for
                    # blocked-upstream-only (#128). Queue row still lists the PR.
                    emit_reason="none"
                fi
                if [[ "$emit_reason" != "none" && -n "$emit_reason" ]]; then
                    local emit_date emit_pr emit_body emit_repo
                    # Window emits key by London hour so 3 daily windows don't collide.
                    if [[ "$emit_reason" == "window" ]]; then
                        emit_date="$(TZ=Europe/London date +%Y-%m-%dT%H)"
                    else
                        emit_date="$(date -u +%Y-%m-%d)"
                    fi
                    emit_pr="${first_pr}"
                    emit_repo="${SESS_PR_REPO[$sid8:$emit_pr]:-${PR_REPO[$emit_pr]:-$UPSTREAM_REPO}}"
                    emit_body="$(pec_build_channel_event_body \
                        --repo "$emit_repo" \
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
            🛑) Q_HOLD+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')") ;;
            ⚠️) Q_WARN+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')") ;;
            🔧)
                if printf '%s' "$acts" | grep -q 'Gate A clean'; then
                    Q_MERGED+=("#$(echo "$prs" | tr ' ' ',') [$sid8] MERGED - Gate A clean; exit reflection then ack + idle; archive pending")
                else
                    Q_MERGED+=("#$(echo "$prs" | tr ' ' ',') [$sid8] MERGED - peer: drop soup/wt + exit reflection, then archive")
                fi
                ;;
            🧹) Q_COMPLETE+=("#$(echo "$prs" | tr ' ' ',') [$sid8] COMPLETE - babysit ended (no ping)") ;;
            ✅)
                # Lane overlay: self-merge / Meta-operator vs wait-tiann (chip stays ✅).
                # Fork chips must not land in WAIT TIANN — no upstream PR exists.
                if printf '%s' "$acts" | grep -qE 'self-merge eligible|Meta/operator may merge'; then
                    Q_SELF_MERGE+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')")
                elif printf '%s' "$acts" | grep -q 'wait on Meta/operator'; then
                    Q_WAIT_FORK+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')")
                else
                    Q_WAIT_TIANN+=("#$(echo "$prs" | tr ' ' ',') [$sid8] $(echo "$acts" | tr '\n' ' ' | sed 's/ *$//')")
                fi
                ;;
        esac

        PLAN_ROWS+=("$(jq -cn --arg sid "$sid8" --arg emoji "$combined" --arg prs "$prs" \
            --arg ping "$decision" --arg title "$new_title" \
            --arg renamed "$([[ ${Q_RENAMED[*]:-} == *"$sid8"* ]] && echo yes || echo no)" \
            '{sid:$sid,emoji:$emoji,prs:$prs,ping:$ping,title:$title,renamed:$renamed}')")
    done

    # --- orphan PRs (tracked/open/merged but no session for that repo#number) ---
    local pair_o r_o
    for pair_o in "${!PAIR_SEEN[@]}"; do
        r_o="${pair_o%\#*}"
        p="${pair_o##*\#}"
        [[ -n "${PAIR_OWNED[$pair_o]:-}" ]] && continue
        local e="${PR_BY_REPO_EMOJI[$pair_o]:-${PR_EMOJI[$p]:-?}}"
        case "$e" in
            🔧) Q_ORPHAN+=("$r_o#$p 🔧 merged, no owning session — confirm wave cleanup done / archive") ;;
            📝|"?") : ;;
            *) Q_ORPHAN+=("$r_o#$p $e open, NO HAPI session — assign an owner or spawn a peer") ;;
        esac
        # Orphan ⚠️ emits needs_decision with null relatedSessionId (inbox stays quiet).
        # State-gated like sessions so steady re-runs stay silent.
        if [[ "$EMIT_EVENTS" -eq 1 && "$e" == "⚠️" ]]; then
            local orphan_fp orphan_prev_e orphan_prev_fp orphan_reason orphan_body orphan_date orphan_sticky
            orphan_date="$(date -u +%Y-%m-%d)"
            orphan_fp="$(pec_action_fingerprint "$e" "${PR_BY_REPO_ACTION[$pair_o]:-${PR_ACTION[$p]:-}}")"
            orphan_prev_e="$(printf '%s' "$state" | jq -r --arg p "$pair_o" '(.orphan_prs // {})[$p].emoji // ""')"
            orphan_prev_fp="$(printf '%s' "$state" | jq -r --arg p "$pair_o" '(.orphan_prs // {})[$p].fp // ""')"
            orphan_sticky="${PR_BY_REPO_STICKY[$pair_o]:-}"
            if [[ -z "$orphan_sticky" ]]; then
                orphan_sticky="$(pec_default_sticky_ping "$e" "${PR_BY_REPO_BLOCKED[$pair_o]:-false}")"
            fi
            orphan_reason="$(pec_emit_reason "$e" "$orphan_prev_e" "$orphan_fp" "$orphan_prev_fp" 0 "$now" "$REMINDER_SECS" 0 "$orphan_sticky" || true)"
            if [[ "$orphan_sticky" == "false" ]]; then
                orphan_reason="none"
            fi
            if [[ "$orphan_reason" != "none" && -n "$orphan_reason" ]]; then
                orphan_body="$(pec_build_channel_event_body \
                    --repo "$r_o" \
                    --number "$p" \
                    --emoji "$e" \
                    --action "${PR_BY_REPO_ACTION[$pair_o]:-${PR_ACTION[$p]:-}}" \
                    --fingerprint "$orphan_fp" \
                    --session-id "" \
                    --reason "$orphan_reason" \
                    --date "$orphan_date")"
                if hub_emit_event "$jwt" "$orphan_body"; then
                    new_state="$(printf '%s' "$new_state" | jq -c \
                        --arg p "$pair_o" --arg e "$e" --arg f "$orphan_fp" \
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
            local crepo_w="${SESS_PR_REPO[$sid8:$p]:-${PR_REPO[$p]:-$UPSTREAM_REPO}}"
            # Prefer session-loop emoji (hold overlay already applied). Fall back
            # to classifier + pec_hold_overlay so an unacked 🛑 cannot look like 🔧
            # and join/clear a merge wave (Codex P1 on #124).
            local emoji_w="${SESS_PR_EMOJI[$sid8:$p]:-}"
            if [[ -z "$emoji_w" ]]; then
                emoji_w="${PR_BY_REPO_EMOJI[$crepo_w#$p]:-${PR_EMOJI[$p]:-?}}"
                emoji_w="$(pec_hold_overlay_emoji "$emoji_w" "$new_state" "$crepo_w" "$p")"
            fi
            emojis_w+=("$emoji_w")
        done
        combined_w="$(md_combined_emoji "${emojis_w[@]}")"
        [[ "$combined_w" == "🔧" ]] || continue
        # One member row per PR on this session that is merged.
        for p in $prs; do
            local crepo_w="${SESS_PR_REPO[$sid8:$p]:-${PR_REPO[$p]:-$UPSTREAM_REPO}}"
            local emoji_wp="${SESS_PR_EMOJI[$sid8:$p]:-}"
            if [[ -z "$emoji_wp" ]]; then
                emoji_wp="${PR_BY_REPO_EMOJI[$crepo_w#$p]:-${PR_EMOJI[$p]:-?}}"
                emoji_wp="$(pec_hold_overlay_emoji "$emoji_wp" "$new_state" "$crepo_w" "$p")"
            fi
            [[ "$emoji_wp" == "🔧" ]] || continue
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

    if [[ "$MD_EMIT_FAILURES" -gt 0 ]]; then
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
            if printf '%s' "$acts" | grep -qE 'self-merge eligible|Meta/operator may merge'; then
                state_desc="open PR green - Meta/operator may merge (lane B / fork)"
            elif printf '%s' "$acts" | grep -q 'wait on Meta/operator'; then
                state_desc="open PR green - wait on Meta/operator (fork; not tiann)"
            else
                state_desc="open PR green - wait on tiann (lane A)"
            fi
            ;;
        🔁) state_desc="CI/rebase in flight" ;;
        ⚠️) state_desc="needs work"; rouse=$'\n\n**Meta ping window — are you done yet?** Resume work or reply with the blocker.' ;;
        📝) state_desc="pre-PR - not filed upstream yet" ;;
        🔧)
            if printf '%s' "$acts" | grep -q 'Gate A clean'; then
                state_desc="MERGED - Gate A clean; exit reflection then ack + idle; archive pending"
                rouse=$'\n\n**Meta ping window — Gate A already clean.** Write exit reflection (`docs/plans/retros/TEMPLATE-exit-reflection.md`) or `skip:`, then ack + idle. Do not rematerialize. Do not mid-turn self-archive — Meta archives from outside when idle.'
            else
                state_desc="MERGED - clean up soup/worktree/branch + exit reflection, archive when idle"
                rouse=$'\n\n**Meta ping window — are you done yet?** Drop soup layer + clean worktree/branch + exit reflection (or `skip:`), then ack. Do not rematerialize mid-wave. Do not mid-turn self-archive.'
            fi
            ;;
        🧹) state_desc="COMPLETE - fully cleaned; babysit ended"; rouse="" ;;
        🛑) state_desc="OPERATOR HOLD — do not thin, do not push; wait for ack"; rouse="" ;;
        *) state_desc="see title" ;;
    esac
    local msg="Meta daily — PR status is now **${emoji}** (${state_desc}).${rouse}

Tracked PR(s): #$(echo "$prs" | tr ' ' ',')

${acts}
Status lives on the **session PR chip** (\`externalRefs.status\`), not in the title. Do **not** put ✅/🔁/⚠️/📝/🔧/🧹 in your session title; leave the title as workstream-only. If the chip is missing, run \`hapi link-pr <url>\` (or MCP \`link_pr\`) with awareness on.
Legend: ✅ green (lane A wait / lane B self-merge) · 🔁 CI in flight · ⚠️ fix threads/CI/rebase · 📝 pre-PR · 🔧 merged (cleanup owed) · 🧹 complete (babysit ended — no further Meta pings) · 🛑 operator hold (never ping the coding peer).
Canon: docs/operator/AGENTS.md § Meta PR watcher + feature-work-lifecycle.md § Session titles and PR chips"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] ping $sid8 ($emoji)" >&2
        return 0
    fi
    "$PING_BIN" "$sid8" "$msg" >/dev/null 2>&1 || err "ping failed for $sid8"
}

_print_section() {  # <title> <array-name>
    local title="$1"; shift
    local -a items=()
    local it
    for it in "$@"; do
        [[ -n "$it" ]] && items+=("$it")
    done
    [[ ${#items[@]} -eq 0 ]] && return 0
    echo ""
    echo "$title"
    for it in "${items[@]}"; do
        echo "  - $it"
    done
}

_print_queue() {
    _print_section "🛑  OPERATOR HOLD (ack only — do not ping the peer):" "${Q_HOLD[@]:-}"
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
    _print_section "🧠 SKIPPED (in a turn / thinking — already working):" "${Q_SKIP_RUNNING[@]:-}"
    _print_section "🟢 WAIT TIANN (✅ green, lane A - upstream maintainer merge):" "${Q_WAIT_TIANN[@]:-}"
    _print_section "🟢 WAIT META/OPERATOR (✅ green, fork PR - never tiann):" "${Q_WAIT_FORK[@]:-}"
    _print_section "🟣 SELF-MERGE / META MAY MERGE (✅ green, lane B or fork promote):" "${Q_SELF_MERGE[@]:-}"
    echo ""
    echo "NEXT STEPS:"
    echo "  - Lane A (WAIT TIANN): prepare only; @tiann merges. Agents never gh pr merge."
    echo "  - Fork WAIT META/OPERATOR: heavygee/hapi chips — Meta/operator merges the"
    echo "    fork stack. Do NOT advise wait-on-tiann (no upstream PR)."
    echo "  - Lane B / fork promote (SELF-MERGE): tests/docs auto or low-impact/allowlist."
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
