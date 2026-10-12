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

# Retention prune: keep newest N + active latest target.
PRUNE_ROOT="$TMP/soup-artifacts-prune"
export HAPI_SOUP_ARTIFACTS_ROOT="$PRUNE_ROOT"
export HAPI_SOUP_ARTIFACTS_KEEP=3
mkdir -p "$PRUNE_ROOT"
for t in hapi-soup-v2099.01.01-aaaaaaa hapi-soup-v2099.01.02-bbbbbbb \
    hapi-soup-v2099.01.03-ccccccc hapi-soup-v2099.01.04-ddddddd \
    hapi-soup-v2099.01.05-eeeeeee; do
    mkdir -p "$PRUNE_ROOT/$t"
    echo x >"$PRUNE_ROOT/$t/marker"
done
ln -sfn hapi-soup-v2099.01.05-eeeeeee "$PRUNE_ROOT/latest"
printf '%s\n' hapi-soup-v2099.01.05-eeeeeee >"$PRUNE_ROOT/latest-tag.txt"
driver_soup_single_exe_prune_artifacts
[[ -d "$PRUNE_ROOT/hapi-soup-v2099.01.01-aaaaaaa" ]] && { echo "FAIL: oldest should be pruned"; exit 1; }
[[ -d "$PRUNE_ROOT/hapi-soup-v2099.01.02-bbbbbbb" ]] && { echo "FAIL: second oldest should be pruned"; exit 1; }
[[ -d "$PRUNE_ROOT/hapi-soup-v2099.01.03-ccccccc" && -d "$PRUNE_ROOT/hapi-soup-v2099.01.04-ddddddd" \
    && -d "$PRUNE_ROOT/hapi-soup-v2099.01.05-eeeeeee" ]] \
    || { echo "FAIL: newest 3 should remain"; exit 1; }
[[ -L "$PRUNE_ROOT/latest" ]] || { echo "FAIL: latest symlink missing"; exit 1; }
echo "OK: soup artifacts keep-N prune"

echo "All driver-soup-single-exe-publish tests passed."
