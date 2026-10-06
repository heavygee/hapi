#!/usr/bin/env bash
# Resolve gh pr create target repo and block fork-only diffs against tiann/hapi.
# Sourced by gh-wrapper.sh and hapi-pr-create-fork.sh.
#
# Incident: heavygee/hapi tooling PR #62 filed as cross-repo tiann/hapi#971 (2026-06-24)
# because `gh repo view` defaults to tiann/hapi in this clone.
set -euo pipefail

PR_TARGET_GUARD_ROOT="${PR_TARGET_GUARD_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Paths that must never ride a PR to upstream/main (fork canon / operator tooling).
PR_TARGET_FORK_ONLY_PREFIXES=(
    'docs/tooling/'
    'docs/operator/'
    'docs/plans/'
    'scripts/tooling/'
    '.cursor/rules/'
    'CLAUDE.md'
)

# Infra branch names — fork PRs only unless explicitly using hapi-pr-create with product diff.
PR_TARGET_FORK_INFRA_BRANCH_RE='^(tooling/|docs/|driver/|garden/|chore/fork)'

pr_target_extract_repo_flag() {
    local arg next=0 repo=""
    for arg in "$@"; do
        if [[ $next -eq 1 ]]; then
            repo="$arg"
            next=0
            continue
        fi
        case "$arg" in
            --repo|-R)
                next=1
                ;;
        esac
    done
    printf '%s' "$repo"
}

pr_target_default_gh_repo() {
    gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true
}

pr_target_resolve_repo() {
    local explicit
    explicit="$(pr_target_extract_repo_flag "$@")"
    if [[ -n "$explicit" ]]; then
        printf '%s' "$explicit"
        return 0
    fi
    pr_target_default_gh_repo
}

pr_target_fork_only_paths_in_diff() {
    local range="${1:-upstream/main...HEAD}"
    local path prefix
    while IFS= read -r path; do
        [[ -z "$path" ]] && continue
        for prefix in "${PR_TARGET_FORK_ONLY_PREFIXES[@]}"; do
            if [[ "$path" == "$prefix"* || "$path" == "$prefix" ]]; then
                printf '%s\n' "$path"
            fi
        done
    done < <(git -C "$PR_TARGET_GUARD_ROOT" diff --name-only "$range" 2>/dev/null || true)
}

pr_target_is_fork_infra_branch() {
    local branch="${1:-$(git -C "$PR_TARGET_GUARD_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
    [[ -z "$branch" || "$branch" == "HEAD" ]] && return 1
    [[ "$branch" =~ $PR_TARGET_FORK_INFRA_BRANCH_RE ]]
}

# Print block reason to stdout; exit 0 if block, 1 if allow.
pr_target_upstream_block_reason() {
    local repo="$1"
    shift
    [[ "$repo" != "tiann/hapi" ]] && return 1

    local branch paths
    branch="$(git -C "$PR_TARGET_GUARD_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    paths="$(pr_target_fork_only_paths_in_diff "upstream/main...HEAD" | sort -u)"

    if [[ -n "$paths" ]]; then
        {
            echo "REFUSE: gh pr create targets tiann/hapi but this branch diff includes fork-only paths:"
            echo ""
            while IFS= read -r p; do
                [[ -z "$p" ]] && continue
                echo "  - $p"
            done <<< "$paths"
            echo ""
            cat <<'EOF'
Fork tooling/docs belong on heavygee/hapi main, not upstream.

Use instead:
  hapi-pr-create-fork --title "..." --body-file /tmp/body.md

Or explicitly (after verification):
  gh pr create --repo heavygee/hapi --base main ...

Upstream product PRs only:
  hapi-pr-create --title "..." --body-file /tmp/body.md

Postmortem: accidental tiann/hapi#971 (2026-06-24).
EOF
        }
        return 0
    fi

    if pr_target_is_fork_infra_branch "$branch"; then
        cat <<EOF
REFUSE: gh pr create targets tiann/hapi from infra branch '$branch'.

Branches matching tooling/*, docs/*, driver/*, garden/* are fork-side only.

Use:
  hapi-pr-create-fork --title "..." --body-file /tmp/body.md
EOF
        return 0
    fi

    return 1
}
