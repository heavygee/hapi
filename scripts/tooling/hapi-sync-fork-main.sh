#!/usr/bin/env bash
# Sync fork main with upstream/main, keeping fork-only commits on top.
#
# Fork main should always be: upstream/main + operator docs/plans (never product-only drift).
#
# Usage:
#   hapi-sync-fork-main              # fetch + merge if behind
#   hapi-sync-fork-main --check-only # exit 1 if primary main is behind upstream
#   hapi-sync-fork-main --rebase     # rebase fork-only commits onto upstream (linear history)
#
set -euo pipefail

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
UPSTREAM_REF="${HAPI_UPSTREAM_REF:-upstream/main}"
MAIN_BRANCH="${HAPI_MAIN_BRANCH:-main}"

CHECK_ONLY=0
USE_REBASE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check-only) CHECK_ONLY=1; shift ;;
        --rebase) USE_REBASE=1; shift ;;
        -h|--help)
            sed -n '2,12p' "$0"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

# Worktrees have .git as a file (gitdir:), not a directory — use rev-parse.
if ! git -C "$PRIMARY" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "ERROR: not a git repo: $PRIMARY" >&2
    exit 1
fi

# Resolve the worktree that currently has MAIN_BRANCH checked out (Codex #213).
# Linked worktrees may set HAPI_PRIMARY to a feature WT; `git checkout main` there
# fails when main is already checked out in the canonical primary — or worse,
# repurposes the feature WT. Mutating sync must run in the main worktree;
# --check-only may stay on the caller's path (read-only counts).
hapi_sync_main_worktree() {
    local primary="$1" branch="$2"
    local wt="" cur_branch="" line
    while IFS= read -r line; do
        case "$line" in
            worktree\ *)
                wt="${line#worktree }"
                ;;
            branch\ refs/heads/"$branch")
                if [[ -n "$wt" ]]; then
                    printf '%s\n' "$wt"
                    return 0
                fi
                ;;
            "")
                wt=""
                ;;
        esac
    done < <(git -C "$primary" worktree list --porcelain 2>/dev/null)
    return 1
}

if [[ "$CHECK_ONLY" -eq 0 ]]; then
    main_wt="$(hapi_sync_main_worktree "$PRIMARY" "$MAIN_BRANCH" || true)"
    if [[ -n "${main_wt:-}" ]]; then
        primary_abs="$(cd "$PRIMARY" && pwd)"
        main_abs="$(cd "$main_wt" && pwd)"
        if [[ "$primary_abs" != "$main_abs" ]]; then
            echo "NOTE: HAPI_PRIMARY is a linked worktree; running sync in main worktree:"
            echo "      $main_abs"
            PRIMARY="$main_abs"
        fi
    else
        # main not checked out anywhere — allow checkout in PRIMARY below
        :
    fi
fi

echo "Fetching upstream..."
git -C "$PRIMARY" fetch upstream

if ! git -C "$PRIMARY" show-ref --verify --quiet "refs/remotes/$UPSTREAM_REF"; then
    echo "ERROR: missing $UPSTREAM_REF" >&2
    exit 1
fi

behind="$(git -C "$PRIMARY" rev-list --count "$MAIN_BRANCH..$UPSTREAM_REF" 2>/dev/null || echo 0)"
ahead="$(git -C "$PRIMARY" rev-list --count "$UPSTREAM_REF..$MAIN_BRANCH" 2>/dev/null || echo 0)"

echo "fork $MAIN_BRANCH: ${ahead} ahead, ${behind} behind $UPSTREAM_REF"

if [[ "$behind" -eq 0 ]]; then
    echo "OK: $PRIMARY $MAIN_BRANCH is up to date with $UPSTREAM_REF"
    exit 0
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
    echo "FAIL: $PRIMARY $MAIN_BRANCH is $behind commit(s) behind $UPSTREAM_REF" >&2
    echo "Run: hapi-sync-fork-main" >&2
    # Surface an active operator remat-hold so wave-clear does not "just sync".
    _hold="${HAPI_REMAT_HOLD_FILE:-$HOME/.hapi/remat-hold.json}"
    if [[ -f "$_hold" ]] && command -v jq >/dev/null 2>&1 \
        && [[ "$(jq -r '.active // false' "$_hold" 2>/dev/null)" == "true" ]] \
        && [[ "$(jq -r '.reason // empty' "$_hold" 2>/dev/null)" == operator:* ]]; then
        echo "NOTE: operator remat-hold ACTIVE — mutating sync is refused until hold lifts:" >&2
        echo "      $(jq -r '.reason' "$_hold")" >&2
        echo "      Inspect: hapi-remat-hold status" >&2
    fi
    exit 1
fi

# Operator kitchen pin: remat-hold reason starting with "operator:" blocks
# mutating sync as well as remat (Meta/tooling latch for excluded upstream tips).
_hold="${HAPI_REMAT_HOLD_FILE:-$HOME/.hapi/remat-hold.json}"
if [[ -f "$_hold" ]] && command -v jq >/dev/null 2>&1; then
    if [[ "$(jq -r '.active // false' "$_hold" 2>/dev/null)" == "true" ]]; then
        _reason="$(jq -r '.reason // empty' "$_hold" 2>/dev/null || true)"
        if [[ "$_reason" == operator:* ]]; then
            echo "ERROR: operator remat-hold active — refusing hapi-sync-fork-main" >&2
            echo "       reason: $_reason" >&2
            echo "       Inspect: hapi-remat-hold status" >&2
            echo "       Do NOT sync until operator lifts the hold (would pull excluded upstream tips)." >&2
            exit 76
        fi
    fi
fi

# Durable SHA exclude / require-together pin (survives remat-hold clear).
# schema 1: exclude_shas — refuse sync that would absorb listed SHAs.
# schema 2+: require_together — if any SHA in a group is on main∪upstream,
#            all must be present after sync (refuse incomplete companion sets).
_exclude="${HAPI_UPSTREAM_EXCLUDE_FILE:-$HOME/.hapi/operator-upstream-exclude.json}"
if [[ -f "$_exclude" ]] && command -v jq >/dev/null 2>&1; then
    _blocked="$(jq -r '.exclude_shas[]? // empty' "$_exclude" 2>/dev/null || true)"
    if [[ -n "$_blocked" ]]; then
        while IFS= read -r _sha; do
            [[ -z "$_sha" ]] && continue
            if git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$UPSTREAM_REF" 2>/dev/null \
                && ! git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$MAIN_BRANCH" 2>/dev/null; then
                _why="$(jq -r --arg s "$_sha" '.entries[]? | select(.sha==$s) | .reason // empty' "$_exclude" 2>/dev/null | head -1)"
                echo "ERROR: upstream exclude pin — refusing sync that would absorb $_sha" >&2
                [[ -n "$_why" ]] && echo "       reason: $_why" >&2
                echo "       pin: $_exclude (remove entry only when operator lifts exclude)" >&2
                exit 76
            fi
        done <<<"$_blocked"
    fi
    # If any SHA in a require_together group is on main∪upstream, every SHA in
    # the group must be on main∪upstream (else sync cannot complete the set).
    _n="$(jq -r '.require_together | length // 0' "$_exclude" 2>/dev/null || echo 0)"
    if [[ "${_n:-0}" =~ ^[0-9]+$ && "$_n" -gt 0 ]]; then
        for (( _i=0; _i<_n; _i++ )); do
            _why="$(jq -r --argjson i "$_i" '.require_together[$i].reason // empty' "$_exclude")"
            _any=0
            while IFS= read -r _sha; do
                [[ -z "$_sha" ]] && continue
                if git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$MAIN_BRANCH" 2>/dev/null \
                    || git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$UPSTREAM_REF" 2>/dev/null; then
                    _any=1
                    break
                fi
            done < <(jq -r --argjson i "$_i" '.require_together[$i].all_of[]?' "$_exclude")
            if [[ "$_any" -eq 1 ]]; then
                while IFS= read -r _sha; do
                    [[ -z "$_sha" ]] && continue
                    if ! git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$MAIN_BRANCH" 2>/dev/null \
                        && ! git -C "$PRIMARY" merge-base --is-ancestor "$_sha" "$UPSTREAM_REF" 2>/dev/null; then
                        echo "ERROR: require_together — refusing sync; companion $_sha missing from main and $UPSTREAM_REF" >&2
                        [[ -n "$_why" ]] && echo "       reason: $_why" >&2
                        echo "       pin: $_exclude" >&2
                        exit 76
                    fi
                done < <(jq -r --argjson i "$_i" '.require_together[$i].all_of[]?' "$_exclude")
            fi
        done
    fi
fi

if [[ -n "$(git -C "$PRIMARY" status --porcelain)" ]]; then
    echo "ERROR: $PRIMARY has uncommitted changes — stash or commit before sync" >&2
    git -C "$PRIMARY" status --short | head -20
    exit 1
fi

git -C "$PRIMARY" checkout "$MAIN_BRANCH"

if [[ "$USE_REBASE" -eq 1 ]]; then
    echo "Rebasing $MAIN_BRANCH onto $UPSTREAM_REF..."
    git -C "$PRIMARY" rebase "$UPSTREAM_REF"
else
    echo "Merging $UPSTREAM_REF into $MAIN_BRANCH..."
    git -C "$PRIMARY" merge "$UPSTREAM_REF" -m "merge(upstream): sync tiann/hapi main into fork main ($(git -C "$PRIMARY" rev-parse --short "$UPSTREAM_REF"))"
fi

echo ""
echo "Synced: $(git -C "$PRIMARY" log -1 --oneline)"
echo "Next: review config/driver-manifest.yaml — drop layers now on upstream/main (mirror-to-config if you use ~/.config)"
echo "      hapi-driver-rebuild --build-web --verify  (if soup layers changed)"

# Post-sync branch hygiene check: just-merged upstream may have absorbed some of
# our PRs. Show any branches whose PRs are now merged, are bitrotting, or never had tracking.
if command -v hapi-branch-audit >/dev/null 2>&1; then
    echo ""
    echo "Branch hygiene (post-sync):"
    hapi-branch-audit --on-merge --skip-fetch || true
fi
