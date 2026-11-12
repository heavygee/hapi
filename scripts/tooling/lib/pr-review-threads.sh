#!/usr/bin/env bash
# Paginated review-thread fetch, shared so the page ceiling lives in one place.
#
# Why this exists: GitHub's reviewThreads is a paginated connection, and a bare
# `first: N` silently returns the FIRST N with no error. A PR that grows past N
# starts under-reporting unresolved threads, and an under-count is
# indistinguishable from "all clear". On 2026-11-12 a peer chasing a supposed
# Meta-chip bug on tiann/hapi#2147 had queried `first: 50` against 52 threads:
# the two newest — the only unresolved ones — fell off the end, so three
# consecutive "0 unresolved" verifications all looked like confirmation.
#
# Our own tooling had the same shape in four places, including the merge gate.
# Callers get every node or an error; they never get a silent prefix.

# prt_fetch_threads <owner> <name> <pr> [node_fields]
# Prints a JSON array of ALL reviewThread nodes. Non-zero on transport/parse
# failure with no output — callers must fail closed, because "could not read"
# is not "nothing to read".
prt_fetch_threads() {
    local owner="${1:?owner}" name="${2:?name}" pr="${3:?pr}"
    local fields="${4:-isResolved isOutdated}"
    local gh="${PRT_GH_BIN:-gh}"
    local cursor="" has_next="true" resp page acc="[]"

    while [[ "$has_next" == "true" ]]; do
        if [[ -n "$cursor" ]]; then
            resp="$("$gh" api graphql -f query="
query(\$cursor: String) {
  repository(owner: \"${owner}\", name: \"${name}\") {
    pullRequest(number: ${pr}) {
      reviewThreads(first: 100, after: \$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fields} }
      }
    }
  }
}" -f cursor="$cursor" 2>/dev/null)" || return 1
        else
            resp="$("$gh" api graphql -f query="
{
  repository(owner: \"${owner}\", name: \"${name}\") {
    pullRequest(number: ${pr}) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fields} }
      }
    }
  }
}" 2>/dev/null)" || return 1
        fi

        printf '%s' "$resp" | jq -e '.data.repository.pullRequest.reviewThreads' >/dev/null 2>&1 || return 1
        page="$(printf '%s' "$resp" | jq -c '.data.repository.pullRequest.reviewThreads.nodes // []')" || return 1
        acc="$(jq -cn --argjson a "$acc" --argjson b "$page" '$a + $b')" || return 1

        has_next="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
        cursor="$(printf '%s' "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')"
        [[ "$has_next" == "true" && -n "$cursor" ]] || has_next=false
    done

    printf '%s' "$acc"
}

# prt_count_blocking  (JSON array on stdin) -> count of threads that should block.
#
# Unresolved AND not known-outdated. The `!= true` is deliberate: a null or
# absent isOutdated means "we do not know", and an unknown must COUNT, not be
# waved through. The merge gate previously used `isOutdated == false`, which
# treats null as outdated and fails open — the wrong direction for a gate.
prt_count_blocking() {
    jq '[.[] | select((.isResolved == false) and (.isOutdated != true))] | length'
}
