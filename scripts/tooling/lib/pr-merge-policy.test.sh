#!/usr/bin/env bash
set -euo pipefail
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pr-merge-policy.sh
source "$LIB/pr-merge-policy.sh"

PASS=0; FAIL=0
eq() {
    local label="$1" got="$2" want="$3"
    if [[ "$got" == "$want" ]]; then PASS=$((PASS+1))
    else FAIL=$((FAIL+1)); echo "FAIL: $label want=[$want] got=[$got]" >&2; fi
}

POL="$(pmp_default_policy_json | jq -c .)"

# test-only auto-B (#1268 class) — product file count is 0, but tests exist
files=$'cli/src/modules/common/cursorModels.test.ts\ncli/src/modules/common/cursorModelsSharedCache.test.ts'
got="$(pmp_classify "$POL" 1268 "$files" 16 0 "")"
eq "1268-like tests-only → auto_tests_only" "$got" $'self_merge\tauto_tests_only'

# small product + colocated test: test path ignored for file cap
files=$'shared/src/cursorCliSku.ts\nshared/src/cursorCliSku.test.ts'
got="$(pmp_classify "$POL" 99 "$files" 40 5 "" 40 5)"
eq "product+test under caps (prod delta) → self_merge" "$got" $'self_merge\tauto_size'

# same pair with fat *total* delta but small product delta → still auto-B
got="$(pmp_classify "$POL" 99 "$files" 500 60 "" 40 5)"
eq "fat total delta but small product delta → self_merge" "$got" $'self_merge\tauto_size'

# without product delta args, fat totals still gate (legacy caller)
got="$(pmp_classify "$POL" 99 "$files" 500 60 "")"
eq "legacy caller fat totals → too_large_delta" "$got" $'maintainer\ttoo_large_delta:560>120'

# oversized product → maintainer on delta
got="$(pmp_classify "$POL" 1270 "$files" 136 10 "" 136 10)"
eq "1270-like oversized → too_large_delta" "$got" $'maintainer\ttoo_large_delta:146>120'

# 9 product files → too_many_files; tests do not pad the count
files=$'a.ts\nb.ts\nc.ts\nd.ts\ne.ts\nf.ts\ng.ts\nh.ts\ni.ts\na.test.ts\nb.test.ts'
got="$(pmp_classify "$POL" 1 "$files" 50 0 "" 50 0)"
eq "9 product + tests → too_many_files:9>8" "$got" $'maintainer\ttoo_many_files:9>8'

# 8 product + many tests → under file cap
files=$'a.ts\nb.ts\nc.ts\nd.ts\ne.ts\nf.ts\ng.ts\nh.ts\na.test.ts\nb.test.ts\nc.test.ts'
got="$(pmp_classify "$POL" 2 "$files" 50 0 "" 50 0)"
eq "8 product + tests → auto_size" "$got" $'self_merge\tauto_size'

# promote by label
files=$'shared/src/cursorCliSku.ts\nshared/src/cursorCliSku.test.ts'
got="$(pmp_classify "$POL" 1270 "$files" 136 10 "low-impact,needs-review" 136 10)"
eq "1270 + low-impact label → self_merge" "$got" $'self_merge\tpromoted_label:low-impact'

# promote by allowlist
POL2="$(printf '%s' "$POL" | jq -c '.self_merge.allow_pr_numbers = [1270]')"
got="$(pmp_classify "$POL2" 1270 "$files" 500 60 "" 500 60)"
eq "1270 allowlisted → self_merge" "$got" $'self_merge\tpromoted_allowlist:1270'

# fat non-product docs → maintainer (docs still count)
files=$'docs/guide/foo.md\ndocs/guide/bar.md'
got="$(pmp_classify "$POL" 1 "$files" 200 50 "" 200 50)"
eq "fat docs → maintainer" "$got" $'maintainer\ttoo_large_delta:250>120'

eq "action self_merge" "$(pmp_action_for_lane self_merge)" "full green - self-merge eligible (low-impact)"
eq "action maintainer tiann default" "$(pmp_action_for_lane maintainer)" "full green - wait on tiann"
eq "action maintainer tiann explicit" "$(pmp_action_for_lane maintainer tiann/hapi)" "full green - wait on tiann"
eq "action maintainer fork" "$(pmp_action_for_lane maintainer heavygee/hapi)" "full green - wait on Meta/operator (fork)"
eq "action self_merge fork" "$(pmp_action_for_lane self_merge heavygee/hapi)" "full green - Meta/operator may merge (fork)"

eq "is_test path" "$(pmp_is_test_path 'web/src/foo.test.ts' && echo yes || echo no)" "yes"
eq "is_product path" "$(pmp_is_test_path 'web/src/foo.ts' && echo yes || echo no)" "no"

echo "pr-merge-policy.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
