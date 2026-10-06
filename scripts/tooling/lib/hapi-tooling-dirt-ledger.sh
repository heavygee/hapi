#!/usr/bin/env bash
# Shared ledger for "mess-maker" tooling dirt on the primary mirror.
#
# Tracks which absolute paths *this agent session* dirtied under operator
# tooling paths. The next agent who only needs sync/rebuild must not inherit
# cleanup duty — only the session that wrote the files is nudged to commit.
#
# Ledger dir: ~/.hapi/tooling-dirt/<session_key>.paths  (one abs path per line)
#
# shellcheck shell=bash

HAPI_ROOT="${HAPI_ROOT_OVERRIDE:-$HOME/coding/hapi}"
HAPI_ROOT="${HAPI_ROOT%/}"
TOOLING_DIRT_DIR="${HAPI_TOOLING_DIRT_DIR:-$HOME/.hapi/tooling-dirt}"

# Paths relative to mirror that count as operator utensils (must commit promptly).
hapi_tooling_dirt_is_covered_rel() {
    local rel="$1"
    case "$rel" in
        docs/tooling/*|docs/tooling) return 0 ;;
        docs/operator/*|docs/operator) return 0 ;;
        docs/plans/*|docs/plans) return 0 ;;
        scripts/tooling/*|scripts/tooling) return 0 ;;
        config/driver-manifest.yaml) return 0 ;;
        .cursor/rules/*|.cursor/rules) return 0 ;;
        *) return 1 ;;
    esac
}

hapi_tooling_dirt_abs_to_rel() {
    local abs="$1"
    case "$abs" in
        "$HAPI_ROOT"/*) printf '%s' "${abs#"$HAPI_ROOT"/}" ;;
        *) printf '%s' "$abs" ;;
    esac
}

# True if abs path is on the mirror (not worktree/driver/upstream) and covered.
hapi_tooling_dirt_is_tracked_abs() {
    local abs="$1" rel
    case "$abs" in
        "$HAPI_ROOT"/worktrees/*|"$HAPI_ROOT"/driver/*|"$HAPI_ROOT"/upstream/*|"$HAPI_ROOT"/active/*)
            return 1
            ;;
        "$HAPI_ROOT"/*) ;;
        *) return 1 ;;
    esac
    rel="$(hapi_tooling_dirt_abs_to_rel "$abs")"
    hapi_tooling_dirt_is_covered_rel "$rel"
}

hapi_tooling_dirt_norm_abs() {
    local p="$1"
    case "$p" in
        /*) ;;
        *) p="${PWD}/${p}" ;;
    esac
    # Resolve .. and // without requiring realpath on missing files
    if command -v realpath >/dev/null 2>&1; then
        realpath -m "$p" 2>/dev/null || printf '%s' "$p"
    else
        printf '%s' "$p" | sed -e 's://*:/:g'
    fi
}

hapi_tooling_dirt_session_key_from_json() {
    local json="$1"
    local key
    key="$(printf '%s' "$json" | jq -r '
        .conversation_id
        // .session_id
        // .composerId
        // .generation_id
        // empty
    ' 2>/dev/null || true)"
    if [[ -z "$key" || "$key" == "null" ]]; then
        key="${CURSOR_CONVERSATION_ID:-${CURSOR_SESSION_ID:-${COMPOSER_SESSION_ID:-}}}"
    fi
    if [[ -z "$key" ]]; then
        local tp
        tp="$(printf '%s' "$json" | jq -r '.transcript_path // .agent_transcript_path // empty' 2>/dev/null || true)"
        if [[ -n "$tp" ]]; then
            key="$(printf '%s' "$tp" | sha256sum 2>/dev/null | awk '{print $1}' | head -c 32)"
        fi
    fi
    if [[ -z "$key" ]]; then
        key="fallback-${PPID}-$$"
    fi
    # filesystem-safe
    printf '%s' "$key" | tr -c 'A-Za-z0-9._-' '_'
}

hapi_tooling_dirt_ledger_path() {
    local key="$1"
    mkdir -p "$TOOLING_DIRT_DIR"
    printf '%s/%s.paths' "$TOOLING_DIRT_DIR" "$key"
}

hapi_tooling_dirt_record() {
    local key="$1" abs="$2" ledger
    abs="$(hapi_tooling_dirt_norm_abs "$abs")"
    hapi_tooling_dirt_is_tracked_abs "$abs" || return 0
    ledger="$(hapi_tooling_dirt_ledger_path "$key")"
    if [[ -f "$ledger" ]] && grep -Fxq "$abs" "$ledger" 2>/dev/null; then
        return 0
    fi
    printf '%s\n' "$abs" >>"$ledger"
}

# Paths still dirty in git that this session recorded.
hapi_tooling_dirt_outstanding() {
    local key="$1" ledger abs rel
    ledger="$(hapi_tooling_dirt_ledger_path "$key")"
    [[ -f "$ledger" ]] || return 0
    # Build set of dirty relative paths on mirror
    local dirty_rels
    dirty_rels="$(git -C "$HAPI_ROOT" status --porcelain -u --untracked-files=all 2>/dev/null \
        | awk '{
            # status format: XY PATH or XY ORIG -> PATH
            if ($1 ~ /^R/) { print $NF } else { $1=""; sub(/^ /,""); print }
          }' \
        | sed 's/^"//;s/"$//' || true)"
    while IFS= read -r abs; do
        [[ -z "$abs" ]] && continue
        rel="$(hapi_tooling_dirt_abs_to_rel "$abs")"
        if printf '%s\n' "$dirty_rels" | grep -Fxq "$rel"; then
            printf '%s\n' "$rel"
        fi
    done <"$ledger"
}

hapi_tooling_dirt_clear_clean() {
    local key="$1" ledger tmp abs rel
    ledger="$(hapi_tooling_dirt_ledger_path "$key")"
    [[ -f "$ledger" ]] || return 0
    tmp="${ledger}.tmp"
    : >"$tmp"
    local dirty_rels
    dirty_rels="$(git -C "$HAPI_ROOT" status --porcelain -u --untracked-files=all 2>/dev/null \
        | awk '{ if ($1 ~ /^R/) { print $NF } else { $1=""; sub(/^ /,""); print } }' \
        | sed 's/^"//;s/"$//' || true)"
    while IFS= read -r abs; do
        [[ -z "$abs" ]] && continue
        rel="$(hapi_tooling_dirt_abs_to_rel "$abs")"
        if printf '%s\n' "$dirty_rels" | grep -Fxq "$rel"; then
            printf '%s\n' "$abs" >>"$tmp"
        fi
    done <"$ledger"
    mv -f "$tmp" "$ledger"
    if [[ ! -s "$ledger" ]]; then
        rm -f "$ledger"
    fi
}
