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

# Paginated: `first: 50` returned a silent prefix, so any PR past 50 threads
# under-reported — and an under-count reads exactly like "nothing to fix".
# tiann/hapi#2147 had 52 threads with both unresolved ones on the far side of
# that boundary (2026-11-12).
# shellcheck source=/dev/null
source "$(dirname "$(readlink -f "$0")")/lib/pr-review-threads.sh"
unresolved_count=$(prt_fetch_threads "$owner" "$repo" "$pr" 'id isResolved isOutdated' 2>/dev/null \
    | prt_count_blocking 2>/dev/null)
[ -n "$unresolved_count" ] || unresolved_count="?"

latest=$(gh pr view "$pr" --comments 2>/dev/null | tail -40 || echo "(could not fetch comments)")

cat <<EOF
10-minute post-push check on PR #$pr: $unresolved_count unresolved thread(s).

$next_push_reminder

UNRESOLVED THREADS: $unresolved_count — reply and resolve any findings before proceeding.

Latest comments:
$latest
EOF
