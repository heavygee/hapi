#!/usr/bin/env bash
# Unit smoke for require-gh-version.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=require-gh-version.sh
source "$DIR/require-gh-version.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }
check() { if eval "$2"; then ok; else bad "$1"; fi; }

check "2.96 >= 2.80" "_gh_version_ge 2.96.0 2.80.0"
check "2.23 < 2.80" "! _gh_version_ge 2.23.0 2.80.0"
check "equal ok" "_gh_version_ge 2.80.0 2.80.0"
check "live /usr/bin/gh meets floor" "require_gh_version /usr/bin/gh"
check "refuse absurd floor" "! HAPI_GH_MIN_VERSION=99.0.0 require_gh_version /usr/bin/gh"

echo "require-gh-version.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
