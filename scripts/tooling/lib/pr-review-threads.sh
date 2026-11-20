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
    # Pin the host. gh's default host on an estate box can be the enterprise
    # instance (lhs.ghe.com here), where tiann/hapi does not exist, so every
    # call returned NOT_FOUND and the 0-on-failure callers read it as "no
    # unresolved threads" (2026-11-20). GH_HOST works for both `gh api` and
    # `gh pr view`; --hostname does not exist on the latter.
    local gh_host="${PRT_GH_HOST:-github.com}"
    local cursor="" has_next="true" resp page acc="[]"

    while [[ "$has_next" == "true" ]]; do
        if [[ -n "$cursor" ]]; then
            resp="$(GH_HOST="$gh_host" "$gh" api graphql -f query="
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
            resp="$(GH_HOST="$gh_host" "$gh" api graphql -f query="
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

# prt_checks_settled <owner> <name> <pr> [required_check]
#
# Exit 0 only when CI has genuinely finished. Prints `<head_sha> total=<n>
# pending=<n> <required>=<state>` on every path so a caller can log it.
# Exit 1 = not settled yet. Exit 2 = could not read (fail closed).
#
# Why this exists: "settled" is almost always implemented as a pending-count of
# zero, and that fires on NO DATA. On 2026-11-17 two sessions wrote that loop
# independently within an hour, watching the same PR, and both fired early:
#
#   1. `gh pr checks` returns zero rows during the window just after a push.
#      `grep -c pending` on an empty response is 0, so "nothing pending" passes
#      with nothing to pass on. One watcher reported ALL CHECKS SETTLED,
#      BLOCKING=0 against a commit whose checks did not exist yet.
#   2. Checks are created in waves. There is a real window where every visible
#      check has finished and `pr-review` — the one that generates findings —
#      has not been created. Zero pending, zero findings, and a review comment
#      lands two minutes later.
#
# So a row floor and an explicit required-check gate, not just a pending count.
# Default required check is `pr-review` because that is the finding generator;
# pass "" to disable only if the repo has no such check.
prt_checks_settled() {
    local owner="${1:?owner}" name="${2:?name}" pr="${3:?pr}"
    local required="${4-pr-review}"
    local gh="${PRT_GH_BIN:-gh}" gh_host="${PRT_GH_HOST:-github.com}" resp total pending req_state head

    resp="$(GH_HOST="$gh_host" "$gh" pr view "$pr" -R "${owner}/${name}" --json statusCheckRollup,headRefOid 2>/dev/null)" || return 2
    printf '%s' "$resp" | jq -e '.statusCheckRollup' >/dev/null 2>&1 || return 2

    head="$(printf '%s' "$resp" | jq -r '.headRefOid // "unknown" | .[0:9]')"
    total="$(printf '%s' "$resp" | jq '[.statusCheckRollup[]?] | length')"
    # CheckRun: status QUEUED/IN_PROGRESS/COMPLETED. StatusContext: state PENDING.
    pending="$(printf '%s' "$resp" | jq '
        [ .statusCheckRollup[]?
          | select((.status // "") != "COMPLETED" and (.state // "") == "PENDING"
                   or ((.status // "") | IN("QUEUED","IN_PROGRESS","WAITING","PENDING","REQUESTED")))
        ] | length')"
    req_state="absent"
    if [[ -n "$required" ]]; then
        req_state="$(printf '%s' "$resp" | jq -r --arg r "$required" '
            [ .statusCheckRollup[]? | select((.name // .context) == $r) ] as $m
            | if ($m | length) == 0 then "absent"
              else ($m[0].conclusion // $m[0].state // $m[0].status // "unknown") end')"
    fi

    printf '%s total=%s pending=%s %s=%s\n' "$head" "$total" "$pending" "${required:-none}" "$req_state"

    # Fail closed on an empty rollup: no rows is not "nothing to wait for".
    [[ "${total:-0}" -ge 1 ]] || return 1
    [[ "${pending:-1}" -eq 0 ]] || return 1
    if [[ -n "$required" ]]; then
        case "$req_state" in
            absent|unknown|PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED) return 1 ;;
        esac
    fi
    return 0
}

# prt_external_review_count <owner> <name> <pr> [self_logins_csv]
#
# Prints the number of reviews from accounts that are neither bots nor our own,
# i.e. actual outside review. Exit 2 if unreadable.
#
# Why this exists: a merge-readiness check that asks "are there human reviews?"
# counts our own in-thread replies. Replying to a review comment creates a
# review row with state COMMENTED under YOUR login. tiann/hapi#2481 finished
# with four `heavygee: COMMENTED` rows that were purely reply artifacts, an
# empty reviewDecision, and no outside reviewer at all — a state that reads as
# "four human reviews" to anything counting non-bot logins.
#
# Green CI plus self-authored COMMENTED rows is not review. Default self list
# is the estate's GitHub identities; override for other setups.
prt_external_review_count() {
    local owner="${1:?owner}" name="${2:?name}" pr="${3:?pr}"
    local selves="${4:-heavygee,gavinc,sterlingchad}"
    local gh="${PRT_GH_BIN:-gh}" gh_host="${PRT_GH_HOST:-github.com}" resp

    resp="$(GH_HOST="$gh_host" "$gh" api "repos/${owner}/${name}/pulls/${pr}/reviews" 2>/dev/null)" || return 2
    printf '%s' "$resp" | jq -e 'type == "array"' >/dev/null 2>&1 || return 2

    printf '%s' "$resp" | jq --arg selves "$selves" '
        ($selves | split(",")) as $mine
        | [ .[]
            | select((.user.login // "") | test("bot$|\\[bot\\]|^github-actions"; "i") | not)
            | select(([.user.login] - $mine) | length > 0)
          ] | length'
}
