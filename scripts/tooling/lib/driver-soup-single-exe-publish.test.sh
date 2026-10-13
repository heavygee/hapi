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

# Release notes: synthetic repo with two tips (no gh needed for tip-from-short).
NOTES_REPO="$TMP/notes-git"
mkdir -p "$NOTES_REPO"
git -C "$NOTES_REPO" init -q
git -C "$NOTES_REPO" config user.email "test@example.com"
git -C "$NOTES_REPO" config user.name "Test"
echo one >"$NOTES_REPO/a.txt"
git -C "$NOTES_REPO" add a.txt
git -C "$NOTES_REPO" commit -qm "feat: first soup tip"
PREV_SHA="$(git -C "$NOTES_REPO" rev-parse HEAD)"
PREV_SHORT="${PREV_SHA:0:7}"
echo two >"$NOTES_REPO/b.txt"
git -C "$NOTES_REPO" add b.txt
git -C "$NOTES_REPO" commit -qm "fix: second tip lands (#9999)"
NEW_SHA="$(git -C "$NOTES_REPO" rev-parse HEAD)"
FAKE_PREV_TAG="hapi-soup-v2099.01.01-${PREV_SHORT}"
FAKE_NEW_TAG="hapi-soup-v2099.01.02-${NEW_SHA:0:7}"

# Stub previous-tag lookup (avoid live gh dependency in unit path).
driver_soup_single_exe_previous_release_tag() {
    printf '%s\n' "$FAKE_PREV_TAG"
}

resolved="$(driver_soup_single_exe_tip_from_release_tag "$NOTES_REPO" "heavygee/hapi" "$FAKE_PREV_TAG")"
[[ "$resolved" == "$PREV_SHA" ]] || { echo "FAIL: tip_from_release_tag ($resolved != $PREV_SHA)"; exit 1; }
echo "OK: tip_from_release_tag short suffix"

notes="$(driver_soup_single_exe_release_notes "$NOTES_REPO" "$NEW_SHA" "$FAKE_NEW_TAG" "heavygee/hapi")"
printf '%s\n' "$notes" | grep -q 'fix: second tip lands (#9999)' \
    || { echo "FAIL: notes missing commit subject"; printf '%s\n' "$notes"; exit 1; }
printf '%s\n' "$notes" | grep -q 'Composed tip' \
    || { echo "FAIL: notes missing composed tip"; exit 1; }
printf '%s\n' "$notes" | grep -q 'Automated soup single-exe publish' \
    && { echo "FAIL: notes still use boilerplate opener"; exit 1; }
echo "OK: release notes include changelog subjects"

# Tip-stamp rebuild gate (the silent-stale publish bug, 2026-10).
STAMP_DRIVER="$TMP/stamp-driver"
mkdir -p "$STAMP_DRIVER/cli/dist-exe"
git -C "$STAMP_DRIVER" init -q
git -C "$STAMP_DRIVER" config user.email "test@example.com"
git -C "$STAMP_DRIVER" config user.name "Test"
echo src >"$STAMP_DRIVER/cli/app.txt"
git -C "$STAMP_DRIVER" add cli/app.txt
git -C "$STAMP_DRIVER" commit -qm "soup tip A"
TIP_A="$(git -C "$STAMP_DRIVER" rev-parse HEAD)"
# Missing stamp → needs rebuild
if ! driver_soup_single_exe_needs_rebuild "$STAMP_DRIVER" "$TIP_A"; then
    echo "FAIL: needs_rebuild should be true when stamp missing"; exit 1
fi
echo "OK: needs_rebuild when unstamped"
# Matching stamp → reuse
printf '%s\n' "$TIP_A" >"$(driver_soup_single_exe_tip_stamp_path "$STAMP_DRIVER")"
if driver_soup_single_exe_needs_rebuild "$STAMP_DRIVER" "$TIP_A"; then
    echo "FAIL: needs_rebuild should be false when stamp matches"; exit 1
fi
echo "OK: needs_rebuild false when stamp matches HEAD"
# Stale stamp → needs rebuild
echo src2 >"$STAMP_DRIVER/cli/app.txt"
git -C "$STAMP_DRIVER" add cli/app.txt
git -C "$STAMP_DRIVER" commit -qm "soup tip B"
TIP_B="$(git -C "$STAMP_DRIVER" rev-parse HEAD)"
if ! driver_soup_single_exe_needs_rebuild "$STAMP_DRIVER" "$TIP_B"; then
    echo "FAIL: needs_rebuild should be true when stamp stale"; exit 1
fi
echo "OK: needs_rebuild when stamp stale"

# Stale-retag integrity gate
ART="$TMP/artifacts"
mkdir -p "$ART/latest/linux-x64-baseline" "$TMP/new/linux-x64-baseline"
printf 'stale-bytes' >"$ART/latest/linux-x64-baseline/hapi"
printf 'stale-bytes' >"$TMP/new/linux-x64-baseline/hapi"
jq -n --arg tip "$TIP_A" '{composedTipSha: $tip}' >"$ART/latest/manifest.json"
driver_soup_single_exe_artifacts_root() { printf '%s\n' "$ART"; }
if driver_soup_single_exe_assert_not_retagging_stale "$TMP/new" "$TIP_B"; then
    echo "FAIL: assert_not_retagging_stale should reject identical bytes across tip change"
    exit 1
fi
echo "OK: assert_not_retagging_stale rejects identical bytes"
printf 'fresh-bytes' >"$TMP/new/linux-x64-baseline/hapi"
driver_soup_single_exe_assert_not_retagging_stale "$TMP/new" "$TIP_B" \
    || { echo "FAIL: assert should allow digest churn"; exit 1; }
echo "OK: assert_not_retagging_stale allows fresh bytes"
# Same tip republish may keep bytes
driver_soup_single_exe_assert_not_retagging_stale "$TMP/new" "$TIP_A" \
    || { echo "FAIL: same-tip republish should be allowed"; exit 1; }
echo "OK: assert allows same-tip republish"

# Fleet seal pointer (operator seal vs dogfood latest)
# Skip live GH channel + dispatch in unit tests (exercised via --dry-run + helpers).
export HAPI_SKIP_FLEET_GITHUB_CHANNEL=1
export HAPI_SKIP_FLEET_DISPATCH=1
SEAL_ROOT="$TMP/seal-artifacts"
SEAL_TAG="hapi-soup-v2099.12.01-abcdef0"
mkdir -p "$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline"
printf 'seal-bytes-v1' >"$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline/hapi"
SEAL_SHA="$(driver_soup_single_exe_sha256_file "$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline/hapi")"
jq -n \
    --arg tag "$SEAL_TAG" \
    --arg tip "$TIP_B" \
    --arg sha "$SEAL_SHA" \
    '{schema:1, tag:$tag, composedTipSha:$tip, binaries:[{target:"bun-linux-x64-baseline",platform:"linux",arch:"x64",variant:"baseline",path:"linux-x64-baseline/hapi",sha256:$sha,sizeBytes:13}]}' \
    >"$SEAL_ROOT/$SEAL_TAG/manifest.json"
ln -sfn "$SEAL_TAG" "$SEAL_ROOT/latest"
printf '%s\n' "$SEAL_TAG" >"$SEAL_ROOT/latest-tag.txt"
driver_soup_single_exe_artifacts_root() { printf '%s\n' "$SEAL_ROOT"; }

driver_soup_fleet_seal --dry-run \
    || { echo "FAIL: dry-run seal should succeed"; exit 1; }
echo "OK: fleet-seal dry-run"

driver_soup_fleet_seal \
    || { echo "FAIL: fleet-seal should succeed"; exit 1; }
[[ "$(readlink "$SEAL_ROOT/fleet-latest")" == "$SEAL_TAG" ]] \
    || { echo "FAIL: fleet-latest symlink"; exit 1; }
[[ "$(tr -d '[:space:]' <"$SEAL_ROOT/fleet-latest-tag.txt")" == "$SEAL_TAG" ]] \
    || { echo "FAIL: fleet-latest-tag.txt"; exit 1; }
[[ "$(readlink "$SEAL_ROOT/latest")" == "$SEAL_TAG" ]] \
    || { echo "FAIL: seal must not disturb latest"; exit 1; }
echo "OK: fleet-seal points fleet-latest without moving latest"

# Digest mismatch refuse
printf 'tampered' >"$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline/hapi"
if driver_soup_fleet_seal "$SEAL_TAG"; then
    echo "FAIL: seal should refuse digest mismatch"
    exit 1
fi
echo "OK: fleet-seal refuses digest mismatch"

# Restore bytes for channel helper checks
printf 'seal-bytes-v1' >"$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline/hapi"
SEAL_SHA="$(driver_soup_single_exe_sha256_file "$SEAL_ROOT/$SEAL_TAG/linux-x64-baseline/hapi")"
jq -n \
    --arg tag "$SEAL_TAG" \
    --arg tip "$TIP_B" \
    --arg sha "$SEAL_SHA" \
    '{schema:1, tag:$tag, composedTipSha:$tip, binaries:[{target:"bun-linux-x64-baseline",platform:"linux",arch:"x64",variant:"baseline",path:"linux-x64-baseline/hapi",sha256:$sha,sizeBytes:13}]}' \
    >"$SEAL_ROOT/$SEAL_TAG/manifest.json"

url="$(driver_soup_fleet_github_manifest_url)"
[[ "$url" == *"releases/download/hapi-fleet/manifest.json" ]] \
    || { echo "FAIL: default fleet manifest URL: $url"; exit 1; }
echo "OK: fleet GH manifest URL defaults to hapi-fleet channel"

unset HAPI_SKIP_FLEET_GITHUB_CHANNEL
driver_soup_fleet_seal_github_channel "$SEAL_ROOT/$SEAL_TAG" "$SEAL_TAG" --dry-run \
    || { echo "FAIL: GH channel dry-run should succeed"; exit 1; }
echo "OK: fleet-seal GH channel dry-run"

echo "All driver-soup-single-exe-publish tests passed."
