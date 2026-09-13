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

name="$(driver_soup_single_exe_github_asset_name linux-x64-baseline hapi)"
[[ "$name" == hapi-linux-x64-baseline ]] || { echo "FAIL: github asset name linux x64 ($name)"; exit 1; }
echo "OK: github asset name linux-x64-baseline"

name="$(driver_soup_single_exe_github_asset_name windows-x64 hapi.exe)"
[[ "$name" == hapi-windows-x64.exe ]] || { echo "FAIL: github asset name windows ($name)"; exit 1; }
echo "OK: github asset name windows-x64"

fixture="$TMP/fixture-release"
mkdir -p "$fixture/linux-x64-baseline" "$fixture/darwin-arm64"
printf '{}' >"$fixture/manifest.json"
printf 'bin' >"$fixture/linux-x64-baseline/hapi"
printf 'bin' >"$fixture/darwin-arm64/hapi"
stage="$TMP/stage-release"
files=()
driver_soup_single_exe_stage_github_assets "$fixture" "$stage" files
[[ "${#files[@]}" == "3" ]] || { echo "FAIL: expected 3 staged files, got ${#files[@]}"; exit 1; }
[[ -f "$stage/manifest.json" && -f "$stage/hapi-linux-x64-baseline" && -f "$stage/hapi-darwin-arm64" ]] \
    || { echo "FAIL: staged asset names missing"; exit 1; }
echo "OK: stage github assets"

echo "All driver-soup-single-exe-publish tests passed."
