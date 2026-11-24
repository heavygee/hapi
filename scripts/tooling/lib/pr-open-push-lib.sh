#!/usr/bin/env bash
# Shared helpers for open-PR push enforcement. Source only.

# Paginated review-thread fetch (prt_fetch_threads). Guarded so repeated
# sourcing from hook chains stays cheap and a missing lib is loud, not a
# silently empty thread list.
#
# `dirname "${BASH_SOURCE[0]}"` alone was wrong and broke this for every agent
# on the box (2026-11-20): BASH_SOURCE is the path as SOURCED, never
# symlink-resolved, and install-hapi-local-bin.sh copied this file into
# ~/.local/bin without its sibling. So `git push` on any open-PR branch printed
# "pr-review-threads.sh: No such file or directory" and carried on.
#
# Carrying on is the dangerous part. pr_unresolved_thread_count has a
# deliberate 0-on-failure contract so GitHub flakiness cannot block every
# `gh pr comment` — but with prt_fetch_threads UNDEFINED that same path returns
# "0 unresolved threads", which reads as a clean PR. A permanently missing
# dependency must never be indistinguishable from nothing left to reply to.
if ! declare -F prt_fetch_threads >/dev/null 2>&1; then
    _prt_self="${BASH_SOURCE[0]}"
    # readlink -f so a ~/.local/bin symlink resolves to the repo lib dir, where
    # the sibling actually lives.
    _prt_dir="$(dirname "$(readlink -f "$_prt_self" 2>/dev/null || printf '%s' "$_prt_self")")"
    for _prt_cand in \
        "$_prt_dir/pr-review-threads.sh" \
        "${HAPI_PRIMARY:-$HOME/coding/hapi}/scripts/tooling/lib/pr-review-threads.sh"
    do
        if [[ -r "$_prt_cand" ]]; then
            # shellcheck source=/dev/null
            source "$_prt_cand"
            break
        fi
    done
    unset _prt_self _prt_dir _prt_cand
fi

# Still missing => local misconfiguration, not a flaky API.
#
# The warning has to be emitted HERE, at source time. Callers invoke
# prt_fetch_threads as `$(prt_fetch_threads ... 2>/dev/null)` to keep flaky-API
# noise out of hook output, so a message printed from inside the shim is
# swallowed by the caller's own redirect — which is how the first version of
# this fix still produced a silent "0 unresolved".
if ! declare -F prt_fetch_threads >/dev/null 2>&1; then
    printf '%s\n' \
        "pr-open-push-lib: CANNOT CHECK PR review threads — pr-review-threads.sh not found." \
        "  Unresolved-thread counts this session are UNAVAILABLE, not zero." \
        "  Do not read a 0 as a clean PR. Fix: bash scripts/tooling/install-hapi-local-bin.sh" >&2
    # Returns non-zero so the 0-on-failure callers still work rather than
    # erroring mid-hook; the source-time warning above is the signal.
    prt_fetch_threads() { return 1; }
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

# Resolve "owner/repo" from a remote. Fails for non-GitHub remotes, of which
# this checkout has several (driver-soup, driver-src and fork are local paths).
pr_open_push_remote_slug() {
    local url slug
    url=$(git remote get-url "$1" 2>/dev/null) || return 1
    url="${url%.git}"
    case "$url" in
        *github.com[:/]*) ;;
        *) return 1 ;;
    esac
    slug="${url#*github.com}"
    slug="${slug#:}"
    slug="${slug#/}"
    [ -n "$slug" ] || return 1
    printf '%s' "$slug"
}

pr_open_push_lookup() {
    local branch="$1"
    local pr base slug owner repo

    slug=$(pr_open_push_remote_slug origin) || return 1
    owner="${slug%%/*}"

    # The head is qualified by OWNER, and the search is scoped to explicit repos.
    #
    # `gh pr list --head "$branch"` was unqualified in two ways at once. It never
    # said WHICH repo to search — with no gh default set, gh resolves one from the
    # remote set, and this checkout carries `upstream` plus half a dozen
    # contributor forks — and it never said WHOSE head branch to match. So on
    # 2026-11-24 a `git push origin main` on the fork matched tiann/hapi#553, an
    # unrelated contributor's PR whose head branch is also named `main`, and told
    # the agent it must cold-review that stranger's WeCom feature before pushing
    # two file renames. A gate that points at someone else's diff is worse than
    # no gate: it trains agents to scroll past the one that matters.
    #
    # Both repos are searched because a fork-main PR lives in UPSTREAM with head
    # "<fork-owner>:main", not in the fork — so scoping to origin alone would
    # miss the real case this gate exists for. Owner-qualifying the head is what
    # excludes other forks' identically-named branches.
    #
    # ORIGIN IS SEARCHED FIRST, and that ordering is deliberate: one branch
    # routinely carries TWO open PRs, the fork's "[cold-review]" PR and the
    # upstream one (e.g. 1996-fold-blocked-filter is fork #337 and upstream
    # #2530). A push to `origin` is the fork event, and the fork's cold-review PR
    # is where that review lives, so it is the more useful of the two to name.
    # The caller contract is one PR, so the other is not reported — if you are
    # chasing upstream CI for a branch, look it up there directly rather than
    # assuming this gate named it.
    for repo in "$slug" $(pr_open_push_remote_slug upstream 2>/dev/null || true); do
        [ -n "$repo" ] || continue
        pr=$(gh api "repos/$repo/pulls?state=open&head=$owner:$branch" \
            --jq '.[0].number // empty' 2>/dev/null || true)
        if [ -n "$pr" ] && [ "$pr" != "null" ]; then
            base=$(gh api "repos/$repo/pulls/$pr" --jq '.base.ref // "main"' 2>/dev/null || echo "main")
            printf '%s %s\n' "$pr" "$base"
            return 0
        fi
    done
    return 1
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
