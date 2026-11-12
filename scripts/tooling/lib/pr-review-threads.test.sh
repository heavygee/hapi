#!/usr/bin/env bash
# Tests for the paginated review-thread fetch.
#
# The case that matters is a PR whose threads span more than one page with the
# only unresolved ones on page 2 — the exact shape of tiann/hapi#2147, where a
# single-page query reported 0 unresolved three times running and looked like
# three confirmations.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/scripts/tooling/lib/pr-review-threads.sh"

fails=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check() {
    local label="$1" want="$2" got="$3"
    if [[ "$got" == "$want" ]]; then
        echo "OK:   $label ($got)"
    else
        echo "FAIL: $label — wanted $want, got $got"
        fails=$((fails + 1))
    fi
}

# Fake gh: page 1 is 100 resolved threads with hasNextPage, page 2 holds the
# two unresolved ones. A non-paginating caller sees only page 1 and says 0.
cat > "$TMP/gh" <<'FAKE'
#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == cursor=* ]] && SECOND=1; done
if [[ -n "${SECOND:-}" ]]; then
  jq -cn '{data:{repository:{pullRequest:{reviewThreads:{
    pageInfo:{hasNextPage:false,endCursor:null},
    nodes:[{isResolved:false,isOutdated:false},{isResolved:false,isOutdated:null}]}}}}}'
else
  jq -cn '[range(100)|{isResolved:true,isOutdated:false}] as $n
    | {data:{repository:{pullRequest:{reviewThreads:{
        pageInfo:{hasNextPage:true,endCursor:"CUR"}, nodes:$n}}}}}'
fi
FAKE
chmod +x "$TMP/gh"
export PRT_GH_BIN="$TMP/gh"

nodes="$(prt_fetch_threads octo repo 2147)"
rc=$?
check "fetch succeeds across pages" 0 "$rc"
check "collects both pages" 102 "$(printf '%s' "$nodes" | jq 'length')"
check "counts blocking threads from page 2" 2 "$(printf '%s' "$nodes" | prt_count_blocking)"

# A null isOutdated must COUNT — unknown cannot be waved through a gate. The
# old `isOutdated == false` predicate would have scored this 1 instead of 2.
check "null isOutdated counts as blocking" 1 \
    "$(jq -cn '[{isResolved:false,isOutdated:null}]' | prt_count_blocking)"
check "known-outdated is excluded" 0 \
    "$(jq -cn '[{isResolved:false,isOutdated:true}]' | prt_count_blocking)"
check "resolved is excluded" 0 \
    "$(jq -cn '[{isResolved:true,isOutdated:false}]' | prt_count_blocking)"

# Transport failure must be an error, not an empty array that reads as "clean".
cat > "$TMP/gh-fail" <<'FAKE'
#!/usr/bin/env bash
echo '{"errors":[{"message":"Bad credentials"}]}'
exit 1
FAKE
chmod +x "$TMP/gh-fail"
PRT_GH_BIN="$TMP/gh-fail" prt_fetch_threads octo repo 1 >/dev/null 2>&1
check "transport failure returns non-zero" 1 "$?"

if [[ "$fails" -ne 0 ]]; then
    echo "pr-review-threads.test.sh: $fails failure(s)"
    exit 1
fi
echo "pr-review-threads.test.sh: all cases OK"
