#!/usr/bin/env bash
# shellcheck disable=SC1091
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

LIB="$(dirname "$(readlink -f "$0")")/driver-soup-single-exe-publish.sh"
# shellcheck source=driver-soup-single-exe-publish.sh
source "$LIB"

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"

if ! git -C "$DRIVER" rev-parse HEAD >/dev/null 2>&1; then
    echo "SKIP: driver worktree missing at $DRIVER"
    exit 0
fi

tag="$(driver_soup_single_exe_tag "$DRIVER")"
[[ "$tag" =~ ^hapi-soup-v[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-f]{7}$ ]] \
    || { echo "FAIL: bad tag format: $tag"; exit 1; }
echo "OK: tag format $tag"

driver_soup_single_exe_parse_target bun-linux-x64-baseline
[[ "$PLATFORM" == linux && "$ARCH" == x64 && "$VARIANT" == baseline ]] \
    || { echo "FAIL: parse linux baseline ($PLATFORM/$ARCH/$VARIANT)"; exit 1; }
echo "OK: parse linux-x64-baseline"

driver_soup_single_exe_parse_target bun-darwin-arm64
[[ "$PLATFORM" == darwin && "$ARCH" == arm64 && "$VARIANT" == "" ]] \
    || { echo "FAIL: parse darwin arm64"; exit 1; }
echo "OK: parse darwin-arm64"

pv="$(driver_soup_single_exe_protocol_version "$DRIVER")"
[[ "$pv" =~ ^[0-9]+$ ]] || { echo "FAIL: protocol version"; exit 1; }
echo "OK: protocolVersion=$pv"

if driver_soup_single_exe_host_ok; then
    echo "OK: oos soup foundry host detected"
else
    echo "OK: non-oos host (publish would skip)"
fi

echo "All driver-soup-single-exe-publish tests passed."
