#!/usr/bin/env bash
# Shared helpers for open-PR push enforcement. Source only.

# Paginated review-thread fetch (prt_fetch_threads). Guarded so repeated
# sourcing from hook chains stays cheap and a missing lib is loud, not a
# silently empty thread list.
if ! declare -F prt_fetch_threads >/dev/null 2>&1; then
    # shellcheck source=/dev/null
    source "$(dirname "${BASH_SOURCE[0]}")/pr-review-threads.sh"
fi

pr_extract_push_branch() {
    local cmd="$1"
    if [[ ! "$cmd" =~ (^|[;&|[:space:]])git[[:space:]]+push ]]; then
        return 1
    fi
    if [[ ! "$cmd" =~ origin ]]; then
        return 1
    fi
    local branch
    branch=$(echo "$cmd" | sed -E 's/.*origin[[:space:]]+//' | awk '{print $1}')
    if [ -z "$branch" ] || [ "$branch" = "-u" ] || [ "$branch" = "--force" ] || [ "$branch" = "-f" ]; then
        return 1
    fi
    if [[ "$branch" == *:* ]]; then
        branch="${branch#*:}"
    fi
    printf '%s' "$branch"
}

pr_open_push_lookup() {
    local branch="$1"
    local pr base
    pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)
    if [ -z "$pr" ] || [ "$pr" = "null" ]; then
        return 1
    fi
    base=$(gh pr view "$pr" --json baseRefName --jq -r '.baseRefName' 2>/dev/null || echo "main")
    printf '%s %s\n' "$pr" "$base"
}

pr_open_push_cold_review_message() {
    local branch="$1"
    local pr="$2"
    local base="${3:-main}"
    cat <<EOF
STOP — OPEN PR PUSH on branch ${branch} (PR #${pr}).

Before \`git push origin ${branch}\` (or before ending your turn if the push already ran), you MUST:

1. Run /requesting-code-review on the full PR diff — same severity bar as upstream PR review.
   Rubric: docs/tooling/cold-pr-review-rubric.md (in hapi) or ~/coding/hapi/docs/tooling/cold-pr-review-rubric.md
2. Run /verification-before-completion on every package you changed (evidence, not vibes).
3. Fix all Blocker/Major findings before push. Do not claim done while threads or findings remain.

Diff:
  git fetch origin && git diff origin/${base}...HEAD

Upstream automation re-runs on every push. Your cold review must match that scope.
EOF
}

pr_open_push_next_push_reminder() {
    local branch="$1"
    local pr="$2"
    local base="${3:-main}"
    cat <<EOF
OPEN PR ITERATION REMINDER (PR #${pr}, branch ${branch})

Before your NEXT push to this branch:
- /requesting-code-review on origin/${base}...HEAD (rubric: docs/tooling/cold-pr-review-rubric.md)
- /verification-before-completion with evidence
- Fix Blocker/Major findings; reply + resolve any bot threads
EOF
}

# Extract owner/repo from a PR URL or fall back to current repo.
# Usage: pr_repo_for_number <pr_number_or_url>
# Echoes "owner repo" on success.
pr_repo_for_number() {
    local arg="$1"
    if [[ "$arg" =~ ^https?://[^/]+/([^/]+)/([^/]+)/(pull|issues)/[0-9]+ ]]; then
        printf '%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        return 0
    fi
    local nwo
    nwo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)
    if [ -n "$nwo" ]; then
        printf '%s %s\n' "${nwo%/*}" "${nwo#*/}"
        return 0
    fi
    return 1
}

# Count unresolved review threads on a PR.
# Usage: pr_unresolved_thread_count <owner> <repo> <pr_number>
# Echoes integer (0 on lookup failure).
pr_unresolved_thread_count() {
    local owner="$1" repo="$2" pr="$3" nodes
    # Paginated: a bare `first: 100` silently truncates on longer PRs and an
    # under-count here reads as "no threads to reply to" (#2147, 2026-11-12).
    # Predicate deliberately unchanged — this gate counts every unresolved
    # thread, including outdated ones, because an outdated finding still wants
    # a threaded reply rather than a top-level comment.
    # The 0-on-failure contract above is also deliberate and preserved: hard
    # failing here would block every `gh pr comment` whenever GitHub is flaky.
    nodes="$(prt_fetch_threads "$owner" "$repo" "$pr" 'isResolved' 2>/dev/null)" || { echo 0; return 0; }
    printf '%s' "$nodes" \
        | jq '[.[] | select(.isResolved == false)] | length' 2>/dev/null \
        || echo 0
}

# Summarize unresolved threads on a PR for an agent message.
# Usage: pr_unresolved_thread_summary <owner> <repo> <pr_number>
pr_unresolved_thread_summary() {
    local owner="$1" repo="$2" pr="$3" nodes
    # Paginated for the same reason as the count: a truncated summary omits
    # exactly the newest threads, which are the ones still wanting a reply.
    nodes="$(prt_fetch_threads "$owner" "$repo" "$pr" \
        'isResolved comments(first:1) { nodes { databaseId path line body author { login } } }' 2>/dev/null)" || return 0
    printf '%s' "$nodes" | jq -r '
        map(select(.isResolved == false))
        | .[]
        | (.comments.nodes[0])
        | "  - comment_id=\(.databaseId)  by=\(.author.login)  path=\(.path):\(.line // "?")  body=\(.body | gsub("\n"; " ") | .[0:120])"
    ' 2>/dev/null || true
}

# Extract a PR number from common gh argument shapes.
# Recognizes: bare digits, URLs, --pr <n>, owner/repo#<n>.
# Usage: pr_extract_pr_number_from_args "<remaining args string>"
pr_extract_pr_number_from_args() {
    local args="$1"
    # URL form
    if [[ "$args" =~ /(pull|issues)/([0-9]+) ]]; then
        printf '%s' "${BASH_REMATCH[2]}"
        return 0
    fi
    # owner/repo#<n>
    if [[ "$args" =~ \#([0-9]+) ]]; then
        printf '%s' "${BASH_REMATCH[1]}"
        return 0
    fi
    # First standalone positive integer
    local tok
    for tok in $args; do
        if [[ "$tok" =~ ^[0-9]+$ ]]; then
            printf '%s' "$tok"
            return 0
        fi
    done
    return 1
}
