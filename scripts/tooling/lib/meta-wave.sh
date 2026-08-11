#!/usr/bin/env bash
# meta-wave.sh — pure helpers for Meta daily wave-clear unlock (gate A).
#
# Gate A: owned 🔧 sessions only. A member is clean when:
#   1. no active soup layer attributable to that PR in the manifest text
#   2. no live worktree at the session's metadata.path (when under worktrees/)
# Orphans (merged PR, no HAPI session) never enter the wave and never block.
#
# Sourced by hapi-meta-daily.sh. Unit tests: lib/meta-wave.test.sh
# NO network. Callers inject manifest text + worktree existence checks.

# mw_manifest_pr_layer_active <manifest_text> <pr_number>
# Exit 0 if an active (uncommented) layer is attributable to PR; 1 if clean.
mw_manifest_pr_layer_active() {
    local text="$1" pr="$2"
    [[ -n "$pr" && "$pr" =~ ^[0-9]+$ ]] || return 1

    # Active `- pr: N` layer
    if printf '%s\n' "$text" | grep -Eiq "^[[:space:]]*-[[:space:]]*pr:[[:space:]]*${pr}[[:space:]]*$"; then
        return 0
    fi

    # Walk lines: accumulate a comment "block", then test the next active layer line.
    local block="" line stripped
    while IFS= read -r line || [[ -n "$line" ]]; do
        stripped="${line#"${line%%[![:space:]]*}"}"
        if [[ -z "$stripped" ]]; then
            block=""
            continue
        fi
        if [[ "$stripped" == \#* ]]; then
            block+="$stripped"$'\n'
            continue
        fi
        if [[ "$stripped" =~ ^-[[:space:]]*(branch|pr|integrate): ]]; then
            if _mw_block_mentions_pr "$block" "$pr" && ! _mw_block_dropped_pr "$block" "$pr"; then
                return 0
            fi
            block=""
            continue
        fi
        # Other non-comment content (e.g. base:) resets the block.
        if [[ "$stripped" != \#* ]]; then
            block=""
        fi
    done <<<"$text"
    return 1
}

# Comment block mentions this PR as an owned/subject ref — not an incidental
# compound like "Post-#1195/#896 detect rebase" on someone else's layer.
_mw_block_mentions_pr() {
    local block="$1" pr="$2"
    # PR #N / hapi#N / bare #N not immediately after digit, /, or hyphen
    printf '%s' "$block" | grep -Eiq "(PR[[:space:]]*#|hapi#|(^|[^0-9/#-])#)${pr}\\b"
}

# Comment block already marks this PR as DROPPED (layer should be commented out).
_mw_block_dropped_pr() {
    local block="$1" pr="$2"
    printf '%s' "$block" | grep -Eiq "DROPPED.*#${pr}\\b|#${pr}\\b.*DROPPED|MERGED[[:space:]]+(UPSTREAM[[:space:]]+)?as[[:space:]]+(PR[[:space:]]*)?#${pr}\\b"
}

# mw_worktree_present <path> — exit 0 if a real checkout exists under …/worktrees/
# Empty / non-worktree paths → absent (exit 1) = clean for gate A.
# Cursor/IDE may recreate a husk (`.cursor/` only) after `git worktree remove`;
# those must not keep gate A dirty — require a `.git` file/dir (gitlink or repo).
mw_worktree_present() {
    local path="$1"
    [[ -n "$path" ]] || return 1
    [[ "$path" == */worktrees/* || "$path" == */worktrees ]] || return 1
    [[ -d "$path" ]] || return 1
    [[ -e "$path/.git" ]]
}

# mw_wave_member_clean <manifest_text> <session_path> <pr_number>
# Exit 0 if clean; 1 if still dirty. Prints reason to stdout: clean|layer|worktree|layer+worktree
mw_wave_member_clean() {
    local manifest="$1" path="$2" pr="$3"
    local layer=0 wt=0
    if mw_manifest_pr_layer_active "$manifest" "$pr"; then
        layer=1
    fi
    if mw_worktree_present "$path"; then
        wt=1
    fi
    if [[ "$layer" -eq 0 && "$wt" -eq 0 ]]; then
        echo "clean"
        return 0
    fi
    if [[ "$layer" -eq 1 && "$wt" -eq 1 ]]; then
        echo "layer+worktree"
    elif [[ "$layer" -eq 1 ]]; then
        echo "layer"
    else
        echo "worktree"
    fi
    return 1
}

# mw_branch_absent <git_dir> <branch>
# Exit 0 if neither refs/heads/<branch> nor refs/remotes/origin/<branch> exists.
# Empty branch → fail closed (exit 1) — unknown headRef must not promote to complete.
mw_branch_absent() {
    local git_dir="${1:?}" branch="${2:-}"
    [[ -n "$branch" ]] || return 1
    [[ "$branch" != HEAD ]] || return 1
    if git -C "$git_dir" show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
        return 1
    fi
    if git -C "$git_dir" show-ref --verify --quiet "refs/remotes/origin/${branch}" 2>/dev/null; then
        return 1
    fi
    return 0
}

# mw_member_complete <manifest_text> <session_path> <pr_number> <lifecycle_state> <git_dir> <head_branch>
# Estate "complete" (🧹): merged cleanup done — layer DROPPED/absent, no worktree,
# branch gone, session archived. Fail closed on any dirty bit or unknown branch.
# Prints: complete|not_archived|no_branch|layer|worktree|branch|layer+… (reason codes)
# Exit 0 only when complete.
mw_member_complete() {
    local manifest="$1" path="$2" pr="$3" lifecycle="${4:-}" git_dir="${5:-}" branch="${6:-}"
    local reasons=()

    if [[ "$lifecycle" != "archived" ]]; then
        reasons+=("not_archived")
    fi
    if [[ -z "$branch" ]]; then
        reasons+=("no_branch")
    fi

    local clean_reason
    clean_reason="$(mw_wave_member_clean "$manifest" "$path" "$pr")" || true
    if [[ "$clean_reason" != "clean" ]]; then
        reasons+=("$clean_reason")
    fi

    if [[ -n "$branch" ]]; then
        if [[ -z "$git_dir" ]] || ! mw_branch_absent "$git_dir" "$branch"; then
            reasons+=("branch")
        fi
    fi

    if [[ ${#reasons[@]} -eq 0 ]]; then
        echo "complete"
        return 0
    fi
    local IFS=+
    echo "${reasons[*]}"
    return 1
}

# mw_wave_id_from_prs <pr pr pr...> — stable id for a member set
mw_wave_id_from_prs() {
    if [[ $# -eq 0 ]]; then
        echo "w-empty"
        return 0
    fi
    local sorted
    sorted="$(printf '%s\n' "$@" | sort -n | paste -sd- -)"
    echo "w-${sorted}"
}

# mw_advance_wave <prev_wave_json> <members_json> <now_epoch> <collect_secs> <rebuild_busy_01> [allow_dispatch_01]
# members_json: [{"pr":N,"sid":"...","clean":true|false,"path":"..."}, ...]
#   (owned only — caller must exclude orphans)
# allow_dispatch: 1 on ping-enabled Meta runs; 0 on --no-ping refresh (stay ready).
# Prints JSON:
#   { wave:{...}, unlock:true|false, emit_collect:true|false, emit_ready:true|false,
#     defer_reason:""|"rebuild_busy"|"dirty_members"|... }
mw_advance_wave() {
    local prev="${1:-null}" members="$2" now="$3" collect_secs="${4:-1800}" busy="${5:-0}" allow_dispatch="${6:-1}"
    [[ -n "$prev" && "$prev" != "null" ]] || prev='{"status":"idle"}'
    [[ -n "$members" ]] || members='[]'

    local count dirty_count clean_count
    count="$(printf '%s' "$members" | jq 'length')"
    dirty_count="$(printf '%s' "$members" | jq '[.[] | select(.clean != true)] | length')"
    clean_count="$(printf '%s' "$members" | jq '[.[] | select(.clean == true)] | length')"

    if [[ "$count" -eq 0 ]]; then
        jq -cn '{
            wave: {id: "w-empty", members: [], collect_started_at: null, collect_deadline_at: null, status: "idle"},
            unlock: false, emit_collect: false, emit_ready: false, defer_reason: "no_owned_merged"
        }'
        return 0
    fi

    local prs_args=()
    local pr
    while IFS= read -r pr; do
        [[ -n "$pr" ]] && prs_args+=("$pr")
    done < <(printf '%s' "$members" | jq -r '.[].pr')
    local wid
    wid="$(mw_wave_id_from_prs "${prs_args[@]}")"

    local prev_status prev_id prev_started prev_deadline
    prev_status="$(printf '%s' "$prev" | jq -r '.status // "idle"')"
    prev_id="$(printf '%s' "$prev" | jq -r '.id // ""')"
    prev_started="$(printf '%s' "$prev" | jq -r '.collect_started_at // empty')"
    prev_deadline="$(printf '%s' "$prev" | jq -r '.collect_deadline_at // empty')"

    # New member set → fresh wave (unless empty handled above).
    if [[ "$prev_id" != "$wid" ]]; then
        prev_status="idle"
        prev_started=""
        prev_deadline=""
    fi

    # Terminal: this wave id already unlocked once. Never re-unlock — even if
    # a member flickers dirty (orphan dir / not_archived blip) and returns to
    # all-clean. Incident 2026-08-10: hourly Meta re-unlocked w-1372…1467 at
    # 13/14/15 because dispatched → collecting → ready → unlock.
    if [[ "$prev_status" == "dispatched" && "$prev_id" == "$wid" ]]; then
        jq -cn \
            --arg id "$wid" \
            --argjson members "$members" \
            --arg started "${prev_started:-}" \
            --arg deadline "${prev_deadline:-}" \
            '{
                wave: {
                    id: $id,
                    members: $members,
                    collect_started_at: (if $started == "" then null else ($started | tonumber) end),
                    collect_deadline_at: (if $deadline == "" then null else ($deadline | tonumber) end),
                    status: "dispatched"
                },
                unlock: false,
                emit_collect: false,
                emit_ready: false,
                defer_reason: "already_dispatched"
            }'
        return 0
    fi

    local status="idle" started="" deadline="" unlock=false emit_collect=false emit_ready=false defer=""

    if [[ "$dirty_count" -gt 0 && "$clean_count" -eq 0 ]]; then
        status="idle"
        defer="dirty_members"
    elif [[ "$dirty_count" -eq 0 ]]; then
        # All owned members clean → ready (early), or stay/dispatch.
        if [[ "$prev_status" == "ready" && "$prev_id" == "$wid" ]]; then
            status="ready"
            started="${prev_started:-$now}"
            deadline="${prev_deadline:-$((now + collect_secs))}"
        else
            status="ready"
            started="${prev_started:-$now}"
            deadline="${prev_deadline:-$((now + collect_secs))}"
            emit_ready=true
        fi
    else
        # Mixed: some clean, some dirty → collecting
        status="collecting"
        if [[ "$prev_status" == "collecting" && "$prev_id" == "$wid" ]]; then
            started="${prev_started:-$now}"
            deadline="${prev_deadline:-$((now + collect_secs))}"
        else
            started="$now"
            deadline=$((now + collect_secs))
            emit_collect=true
        fi
        defer="dirty_members"
        # Deadline alone never unlocks while dirty remain (plan).
    fi

    if [[ "$status" == "ready" ]]; then
        if [[ "$busy" -eq 1 ]]; then
            unlock=false
            defer="rebuild_busy"
            # emit_ready only on first transition into ready (set above).
        elif [[ "$allow_dispatch" -ne 1 ]]; then
            unlock=false
            defer="awaiting_ping_window"
        else
            unlock=true
            status="dispatched"
            defer=""
        fi
    fi

    jq -cn \
        --arg id "$wid" \
        --argjson members "$members" \
        --arg status "$status" \
        --argjson unlock "$unlock" \
        --argjson emit_collect "$emit_collect" \
        --argjson emit_ready "$emit_ready" \
        --arg defer "$defer" \
        --arg started "${started:-}" \
        --arg deadline "${deadline:-}" \
        '{
            wave: {
                id: $id,
                members: $members,
                collect_started_at: (if $started == "" then null else ($started | tonumber) end),
                collect_deadline_at: (if $deadline == "" then null else ($deadline | tonumber) end),
                status: $status
            },
            unlock: $unlock,
            emit_collect: $emit_collect,
            emit_ready: $emit_ready,
            defer_reason: $defer
        }'
}

# mw_build_wave_event_body — inbox/channel event for collect or ready.
# Flags: --repo --wave-id --prs-csv --kind collect|ready --session-id --date
mw_build_wave_event_body() {
    local repo="" wave_id="" prs_csv="" kind="collect" session_id="" date=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo) repo="$2"; shift 2 ;;
            --wave-id) wave_id="$2"; shift 2 ;;
            --prs-csv) prs_csv="$2"; shift 2 ;;
            --kind) kind="$2"; shift 2 ;;
            --session-id) session_id="$2"; shift 2 ;;
            --date) date="$2"; shift 2 ;;
            *) echo "mw_build_wave_event_body: unknown arg $1" >&2; return 2 ;;
        esac
    done
    [[ -n "$repo" && -n "$wave_id" && -n "$date" ]] \
        || { echo "mw_build_wave_event_body: missing required fields" >&2; return 2; }

    local event_type="needs_decision" summary number=0
    number="$(printf '%s' "$prs_csv" | tr ',' '\n' | grep -E '^[0-9]+$' | head -1 || echo 0)"
    [[ -n "$number" && "$number" != "0" ]] || number=0

    case "$kind" in
        collect)
            summary="Soup rebuild collect window open — wave ${wave_id} (PRs ${prs_csv:-?}); waiting for remaining owned cleanups"
            ;;
        ready)
            summary="WAVE CLEAR — rematerialize soup once for wave ${wave_id} (PRs ${prs_csv:-?}). hapi-driver-status --quiet then hapi-sync-fork-main + hapi-driver-rebuild --build-web --verify"
            ;;
        *) summary="Soup wave ${wave_id} (${kind})" ;;
    esac

    local fp dedupe idempo
    fp="wave:${wave_id}:${kind}"
    dedupe="soup-rebuild:${repo}:${wave_id}:${kind}:${date}"
    idempo="soup-rebuild:${repo}:${wave_id}:${kind}:${date}"
    [[ -n "$session_id" ]] && idempo="${idempo}:sess:${session_id}"

    jq -cn \
        --arg sourceRef "soup-wave:${repo}" \
        --arg eventType "$event_type" \
        --arg summary "$summary" \
        --arg sessionId "$session_id" \
        --arg repo "$repo" \
        --argjson number "$number" \
        --arg waveId "$wave_id" \
        --arg prs "$prs_csv" \
        --arg kind "$kind" \
        --arg dedupe "$dedupe" \
        --arg idempo "$idempo" \
        --arg url "https://github.com/${repo}" \
        '{
            sourceKind: "channel",
            sourceRef: $sourceRef,
            eventType: $eventType,
            attentionCandidate: 1,
            operatorActionRequired: 1,
            summary: $summary,
            relatedSessionId: (if $sessionId == "" then null else $sessionId end),
            artifactRefs: (if $number == 0 then [] else [{
                kind: "github_pr",
                url: ("https://github.com/\($repo)/pull/\($number)"),
                repo: $repo,
                number: $number,
                target_id: "upstream",
                control: "theirs",
                github_state: "merged",
                source: "external"
            }] end),
            payload: { waveId: $waveId, prs: $prs, kind: $kind },
            tags: ["soup-rebuild", "wave-clear", $kind],
            dedupeKey: $dedupe,
            idempotencyKey: $idempo,
            provenance: "soup-wave@meta-daily",
            severity: 3
        }'
}

# mw_driver_stack_busy — exit 0 if rebuild/switch in progress (quiet=75).
# Uses HAPI_META_DRIVER_STATUS_BIN or hapi-driver-status on PATH.
# Missing binary / missing status file → not busy (exit 1) so unlock can proceed
# on fresh machines; the rematerialize script still takes the flock.
mw_driver_stack_busy() {
    local bin="${HAPI_META_DRIVER_STATUS_BIN:-}"
    if [[ -z "$bin" ]]; then
        bin="$(command -v hapi-driver-status 2>/dev/null || true)"
    fi
    if [[ -z "$bin" || ! -x "$bin" ]]; then
        return 1
    fi
    local rc=0
    "$bin" --quiet >/dev/null 2>&1 || rc=$?
    [[ "$rc" -eq 75 ]]
}
