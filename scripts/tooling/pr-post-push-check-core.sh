#!/usr/bin/env bash
# Shared PR post-push review poll. Prints human-readable context to stdout.
# Exit 0 always (callers decide whether to inject into agent context).

set -euo pipefail

# shellcheck source=/dev/null
source "$HOME/.local/bin/pr-open-push-lib.sh"

branch="${1:-}"
if [ -z "$branch" ]; then
    exit 0
fi

lookup=$(pr_open_push_lookup "$branch" || true)
if [ -z "$lookup" ]; then
    exit 0
fi

pr=$(echo "$lookup" | awk '{print $1}')
base=$(echo "$lookup" | awk '{print $2}')
next_push_reminder=$(pr_open_push_next_push_reminder "$branch" "$pr" "$base")

echo "⏳ PR #$pr detected — waiting 10 minutes for bot review before checking comments..." >&2
sleep 600

owner_repo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
owner=$(echo "$owner_repo" | cut -d/ -f1)
repo=$(echo "$owner_repo" | cut -d/ -f2)

unresolved_count=$(gh api graphql -f query="{
  repository(owner:\"$owner\", name:\"$repo\") {
    pullRequest(number: $pr) {
      reviewThreads(first: 50) {
        nodes { id isResolved }
      }
    }
  }
}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' 2>/dev/null || echo "?")

latest=$(gh pr view "$pr" --comments 2>/dev/null | tail -40 || echo "(could not fetch comments)")

cat <<EOF
10-minute post-push check on PR #$pr: $unresolved_count unresolved thread(s).

$next_push_reminder

UNRESOLVED THREADS: $unresolved_count — reply and resolve any findings before proceeding.

Latest comments:
$latest
EOF
