#!/usr/bin/env bash
# Isolated app-hosted UIKit layout tests; never installs into a user's device.
set -euo pipefail
cd "$(dirname "$0")/../.."

runtime=$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
items = [x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x.get("name", "").startswith("iOS")]
print(max(items, key=lambda x: tuple(map(int, x["version"].split("."))))["identifier"])
')
device_type=${HAPI_TEST_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-15}
device=$(xcrun simctl create "HAPI Transcript Tests" "$device_type" "$runtime")
trap 'xcrun simctl delete "$device" >/dev/null 2>&1 || true' EXIT

result_bundle_args=()
if [[ -n "${HAPI_TEST_RESULT_BUNDLE_PATH:-}" ]]; then
    result_bundle_args=(-resultBundlePath "$HAPI_TEST_RESULT_BUNDLE_PATH")
fi

xcodebuild test -project ios/Hapi.xcodeproj -scheme Hapi \
    -destination "platform=iOS Simulator,id=$device" \
    -derivedDataPath "${HAPI_TEST_DERIVED_DATA:-/tmp/hapi-transcript-tests}" \
    -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
    ${result_bundle_args[@]+"${result_bundle_args[@]}"} "$@"
