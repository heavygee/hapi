#!/usr/bin/env bash
# Unit tests for build_web_preflight (operator-local).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=build-web-preflight.sh
source "$LIB/build-web-preflight.sh"

GIB_KIB=$((1024 * 1024))

run_case() {
    local label="$1"
    local expect="$2" # pass | fail
    shift 2
    unset HAPI_BUILD_TEST_MEM_AVAILABLE_KIB HAPI_BUILD_TEST_SWAP_USED_PCT HAPI_BUILD_TEST_SWAP_TOTAL_KIB
    export HAPI_BUILD_PREFLIGHT_SKIP_DROP_CACHES=1
    while [[ $# -gt 0 ]]; do
        export "$1"
        shift
    done
    if build_web_preflight >/tmp/build-web-preflight-test.out 2>&1; then
        rc=0
    else
        rc=1
    fi
    if [[ "$expect" == pass && "$rc" -eq 0 ]]; then
        echo "OK: $label"
        return 0
    fi
    if [[ "$expect" == fail && "$rc" -ne 0 ]]; then
        echo "OK: $label"
        return 0
    fi
    echo "FAIL: $label (expected $expect, rc=$rc)" >&2
    cat /tmp/build-web-preflight-test.out >&2
    exit 1
}

# Sticky swap + healthy RAM → allow (operator scenario).
run_case 'sticky swap high avail' pass \
    HAPI_BUILD_TEST_MEM_AVAILABLE_KIB=$((6 * GIB_KIB)) \
    HAPI_BUILD_TEST_SWAP_USED_PCT=99 \
    HAPI_BUILD_TEST_SWAP_TOTAL_KIB=$((14 * GIB_KIB))

# High swap + tight RAM → refuse.
run_case 'swap high avail tight' fail \
    HAPI_BUILD_TEST_MEM_AVAILABLE_KIB=$((3 * GIB_KIB)) \
    HAPI_BUILD_TEST_SWAP_USED_PCT=99 \
    HAPI_BUILD_TEST_SWAP_TOTAL_KIB=$((14 * GIB_KIB))

# Low RAM alone → refuse even with low swap.
run_case 'avail below floor' fail \
    HAPI_BUILD_TEST_MEM_AVAILABLE_KIB=$((1536 * 1024)) \
    HAPI_BUILD_TEST_SWAP_USED_PCT=10 \
    HAPI_BUILD_TEST_SWAP_TOTAL_KIB=$((14 * GIB_KIB))

# Comfortable on both axes.
run_case 'healthy host' pass \
    HAPI_BUILD_TEST_MEM_AVAILABLE_KIB=$((8 * GIB_KIB)) \
    HAPI_BUILD_TEST_SWAP_USED_PCT=20 \
    HAPI_BUILD_TEST_SWAP_TOTAL_KIB=$((14 * GIB_KIB))

echo "build-web-preflight.test.sh: all cases OK"
