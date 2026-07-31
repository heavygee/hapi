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

# test-only auto-B
files=$'cli/src/modules/common/cursorModels.test.ts\ncli/src/modules/common/cursorModelsSharedCache.test.ts'
got="$(pmp_classify "$POL" 1268 "$files" 16 0 "")"
eq "1268-like auto self_merge" "$got" $'self_merge\tauto_nonproduct'

# product path → maintainer
files=$'shared/src/cursorCliSku.ts\nshared/src/cursorCliSku.test.ts'
got="$(pmp_classify "$POL" 1270 "$files" 136 10 "")"
eq "1270-like product → maintainer" "$got" $'maintainer\tproduct_paths'

# promote by label
got="$(pmp_classify "$POL" 1270 "$files" 136 10 "low-impact,needs-review")"
eq "1270 + low-impact label → self_merge" "$got" $'self_merge\tpromoted_label:low-impact'

# promote by allowlist
POL2="$(printf '%s' "$POL" | jq -c '.self_merge.allow_pr_numbers = [1270]')"
got="$(pmp_classify "$POL2" 1270 "$files" 500 60 "")"
eq "1270 allowlisted → self_merge" "$got" $'self_merge\tpromoted_allowlist:1270'

# fat non-product → maintainer (too large)
files=$'docs/guide/foo.md\ndocs/guide/bar.md'
got="$(pmp_classify "$POL" 1 "$files" 200 50 "")"
eq "fat docs → maintainer" "$got" $'maintainer\ttoo_large_delta:250>120'

eq "action self_merge" "$(pmp_action_for_lane self_merge)" "full green - self-merge eligible (low-impact)"
eq "action maintainer" "$(pmp_action_for_lane maintainer)" "full green - wait on tiann"

echo "pr-merge-policy.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
