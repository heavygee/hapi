#!/usr/bin/env bash
# Tiered fork path policy — sourced by git hooks (pre-commit, pre-push).
#
# Goal: max safe files on public heavygee/hapi; never leak fork canon to upstream.
# docs/plans/ pushes to origin (heavygee/hapi) — upstream PRs still exclude fork paths.
#
# See docs/tooling/commit-hooks.md
set -euo pipefail

# Paths that must never be tracked (any branch, any remote).
fork_path_never_tracked() {
    local path="$1"
    case "$path" in
        localdocs/*|web/public/xr-poc/*|AGENTS.local.md|*/AGENTS.local.md|.specstory|.specstory/*)
            return 0
            ;;
    esac
    return 1
}

# pre-commit: return 0 if path may be staged.
fork_pre_commit_path_ok() {
    local path="$1"

    if fork_path_never_tracked "$path"; then
        return 1
    fi

    case "$path" in
        docs/operator/*|docs/tooling/*|docs/plans/*|.cursor/rules/*)
            return 0
            ;;
    esac

    return 0
}

fork_pre_commit_block_reason() {
    local path="$1"
    if fork_path_never_tracked "$path"; then
        echo "never-tracked path: $path"
        return 0
    fi
    echo "blocked path: $path"
}

# pre-push: return 0 if path may appear in outgoing range for this remote/branch.
fork_pre_push_path_ok() {
    local remote="$1"
    local branch="$2"
    local path="$3"

    if fork_path_never_tracked "$path"; then
        return 1
    fi

    case "$remote" in
        upstream)
            fork_pre_push_upstream_ok "$branch" "$path"
            ;;
        origin)
            fork_pre_push_origin_ok "$branch" "$path"
            ;;
        *)
            # Unknown remotes: strict (treat like upstream).
            fork_pre_push_upstream_ok "$branch" "$path"
            ;;
    esac
}

fork_pre_push_upstream_ok() {
    local branch="$1"
    local path="$2"
    case "$path" in
        docs/operator/*|docs/plans/*|.cursor/rules/operator*)
            return 1
            ;;
    esac
    return 0
}

fork_pre_push_origin_ok() {
    local branch="$1"
    local path="$2"

    case "$branch" in
        main|driver/*|garden/*|tooling/*|docs/*)
            return 0
            ;;
        feat/*|fix/*|soup/*)
            case "$path" in
                docs/operator/*|.cursor/rules/operator*)
                    return 1
                    ;;
            esac
            return 0
            ;;
        *)
            case "$path" in
                docs/operator/*|.cursor/rules/operator*)
                    return 1
                    ;;
            esac
            return 0
            ;;
    esac
}

fork_pre_push_block_reason() {
    local remote="$1"
    local branch="$2"
    local path="$3"

    if fork_path_never_tracked "$path"; then
        echo "never-tracked: $path"
        return 0
    fi

    case "$remote" in
        upstream)
            echo "fork-private on upstream: $path"
            ;;
        origin)
            case "$branch" in
                main|driver/*|garden/*|tooling/*|docs/*) echo "unexpected block on origin/$branch: $path" ;;
                feat/*|fix/*|soup/*) echo "fork canon on origin PR branch: $path" ;;
                *) echo "fork canon on origin branch $branch: $path" ;;
            esac
            ;;
        *)
            echo "fork-private on remote $remote: $path"
            ;;
    esac
}

# Human-readable summary for docs / hook errors.
fork_policy_github_safe_paths() {
    cat <<'EOF'
GitHub-safe on origin/main (push allowed):
  docs/tooling/
  docs/operator/
  docs/plans/
  .cursor/rules/
  CLAUDE.md, scripts/tooling/ (when product-safe)

Local-only (never push — not in git):
  localdocs/

Never tracked:
  AGENTS.local.md, localdocs/, web/public/xr-poc/, .specstory/

Upstream + origin feat/fix/soup branches:
  no docs/operator/, no docs/plans/, no .cursor/rules/operator*
EOF
}
