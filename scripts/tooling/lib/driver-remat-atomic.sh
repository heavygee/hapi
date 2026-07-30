# Atomic soup rematerialize helpers (sourced by hapi-driver-rebuild.sh).
#
# Remat mutates a WIP branch in a side worktree. driver/integration (live tip)
# moves only after layers + heals succeed. On failure the live tip is unchanged
# (or restored if promote already happened and a later gate fails).
#
# Incident 2026-07-29: in-place reset+merge left tip stuck mid-stack (exit=1)
# after cursor-picker; awareness + rich-composer vanished from dogfood source.

# WIP branch name for a given integration branch.
driver_remat_wip_branch() {
    local integration_branch="${1:?}"
    printf '%s\n' "${integration_branch}-wip"
}

# Side worktree path (canonical bucket).
driver_remat_worktree_path() {
    local primary="${1:?}"
    printf '%s\n' "${HAPI_DRIVER_REMAT_WT:-$primary/worktrees/driver-remat}"
}

# Ensure remat worktree exists and is checked out to WIP @ base_ref (hard reset).
# Does not touch the live driver worktree.
# stdout: absolute path to remat worktree only (status → stderr).
driver_remat_prepare() {
    local primary="${1:?}"
    local wip_branch="${2:?}"
    local base_ref="${3:?}"
    local remat_wt
    remat_wt="$(driver_remat_worktree_path "$primary")"

    if [[ ! -d "$remat_wt" ]]; then
        echo "Creating remat worktree at $remat_wt (branch $wip_branch)..." >&2
        # Canonical worktrees/<name> — guard allows this path.
        git -C "$primary" worktree add -B "$wip_branch" "$remat_wt" "$base_ref" >&2
    else
        # Re-enter WIP even if a prior failed remat left it conflicted/detached.
        git -C "$remat_wt" merge --abort >/dev/null 2>&1 || true
        git -C "$remat_wt" checkout -f -B "$wip_branch" "$base_ref" >&2
        git -C "$remat_wt" reset --hard "$base_ref" >&2
        git -C "$remat_wt" clean -fdq
    fi

    printf '%s\n' "$remat_wt"
}

# Point live driver worktree at successful WIP SHA (integration branch tip).
driver_remat_promote() {
    local driver="${1:?}"
    local integration_branch="${2:?}"
    local wip_sha="${3:?}"

    git -C "$driver" merge --abort >/dev/null 2>&1 || true
    git -C "$driver" checkout -f -B "$integration_branch" "$wip_sha"
    git -C "$driver" reset --hard "$wip_sha"
    git -C "$driver" clean -fdq
}

# Restore live driver tip after a post-promote failure (verify/typecheck).
driver_remat_restore_tip() {
    local driver="${1:?}"
    local integration_branch="${2:?}"
    local prev_sha="${3:?}"

    echo "Atomic remat: restoring $integration_branch to pre-remat tip ${prev_sha:0:12}..." >&2
    git -C "$driver" merge --abort >/dev/null 2>&1 || true
    git -C "$driver" checkout -f -B "$integration_branch" "$prev_sha"
    git -C "$driver" reset --hard "$prev_sha"
    git -C "$driver" clean -fdq
}

# Conflict / fail messaging when live tip was never moved.
driver_remat_fail_leave_wip() {
    local remat_wt="${1:?}"
    local wip_branch="${2:?}"
    local integration_branch="${3:?}"
    local prev_sha="${4:?}"
    local merge_ref="${5:-}"

    echo "ERROR: rematerialize failed — live tip $integration_branch UNCHANGED at ${prev_sha:0:12}" >&2
    if [[ -n "$merge_ref" ]]; then
        echo "       conflict while merging $merge_ref" >&2
    fi
    echo "       Resolve in remat worktree: $remat_wt (branch $wip_branch)" >&2
    echo "       Then re-run hapi-driver-rebuild, or: git -C $remat_wt merge --abort" >&2
}
