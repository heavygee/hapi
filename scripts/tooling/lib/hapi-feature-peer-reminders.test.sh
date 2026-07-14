#!/usr/bin/env bash
# Unit tests for hapi_print_feature_peer_reminders (operator-local).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hapi-feature-peer-reminders.sh
source "$LIB/hapi-feature-peer-reminders.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

unset HAPI_SKIP_FEATURE_PEER_REMINDERS
out="$(hapi_print_feature_peer_reminders "unit-test" 2>&1)"
printf '%s' "$out" | grep -q 'display_image' || fail "expected display_image in reminder"
printf '%s' "$out" | grep -q 'unit-test' || fail "expected context string"
printf '%s' "$out" | grep -q 'Proof tiers' || fail "expected Proof tiers header"
echo "OK: prints checklist"

out="$(HAPI_SKIP_FEATURE_PEER_REMINDERS=1 hapi_print_feature_peer_reminders "unit-test" 2>&1)"
if [[ -n "$out" ]]; then
    fail "expected empty output when HAPI_SKIP_FEATURE_PEER_REMINDERS=1, got: $out"
fi
echo "OK: skip env mutes output"

echo "All hapi-feature-peer-reminders tests passed."
