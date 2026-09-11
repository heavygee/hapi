#!/usr/bin/env bash
# driver-soup-single-exe-publish.sh — build + publish soup single-exe fleet artifacts.
#
# Stage 0 of docs/plans/2026-09-04-fleet-vm-swap-strategy.md: after a verified
# soup promote on oos-linux, produce self-contained hapi binaries (CLI+hub+runner,
# embedded web UI) tagged hapi-soup-v<YYYY.MM.DD>-<7-char-tip>.
#
# Publish root (durable, on oos): /var/lib/hapi/soup-artifacts/<tag>/
#   latest -> <tag>     (symlink for fetch-by-tag consumers)
#   manifest.json       (composed tip, layer count, web/dist hash, protocolVersion)
#   <platform-dir>/hapi (or hapi.exe)
#
# Also mirrors the primary linux x64 binary into /var/lib/hapi/upgrade-artifacts/
# as hapi-<tag>-linux-x64-baseline for existing fleet SCP playbooks.
#
# Env:
#   HAPI_SOUP_ARTIFACTS_ROOT  default /var/lib/hapi/soup-artifacts
#   HAPI_SKIP_SOUP_SINGLE_EXE=1   skip (rebuild hook respects this)
#   HAPI_SOUP_SINGLE_EXE_REQUIRED=1  fail hard on publish errors (default when hooked from rebuild --verify --build-web)

driver_soup_single_exe_artifacts_root() {
    printf '%s\n' "${HAPI_SOUP_ARTIFACTS_ROOT:-/var/lib/hapi/soup-artifacts}"
}

# True when this host is the soup foundry (oos-linux pattern).
driver_soup_single_exe_host_ok() {
    [[ -d /var/lib/hapi ]] && [[ -w /var/lib/hapi ]]
}

driver_soup_single_exe_tag() {
    local driver="${1:?}"
    local sha short date_part
    sha="$(git -C "$driver" rev-parse HEAD)"
    short="${sha:0:7}"
    date_part="$(date -u +%Y.%m.%d)"
    printf 'hapi-soup-v%s-%s\n' "$date_part" "$short"
}

driver_soup_single_exe_target_dir() {
    local target="${1:?}"
    printf '%s\n' "${target#bun-}"
}

# Parse bun-<platform>-<arch>[-variant] into platform/arch/variant env vars.
driver_soup_single_exe_parse_target() {
    local target="${1:?}"
    local rest="${target#bun-}"
    PLATFORM="${rest%%-*}"
    local tail="${rest#*-}"
    ARCH="${tail%%-*}"
    VARIANT=""
    if [[ "$tail" == *-* ]]; then
        VARIANT="${tail#*-}"
    fi
}

driver_soup_single_exe_sha256_file() {
    local path="${1:?}"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$path" | awk '{print $1}'
    else
        shasum -a 256 "$path" | awk '{print $1}'
    fi
}

driver_soup_single_exe_protocol_version() {
    local driver="${1:?}"
    local ver
    ver="$(grep -E '^export const PROTOCOL_VERSION' "$driver/shared/src/version.ts" 2>/dev/null \
        | sed -E 's/.*= *([0-9]+).*/\1/' || true)"
    [[ -n "$ver" ]] || ver=1
    printf '%s\n' "$ver"
}

driver_soup_single_exe_web_dist_hash() {
    local driver="${1:?}"
    local index="$driver/web/dist/index.html"
    if [[ ! -f "$index" ]]; then
        printf '%s\n' ''
        return 1
    fi
    driver_soup_single_exe_sha256_file "$index"
}

driver_soup_single_exe_layer_count() {
    local manifest="${1:?}"
    local parse="${2:?}"
    if [[ ! -f "$manifest" || ! -f "$parse" ]]; then
        printf '%s\n' 0
        return 0
    fi
    "$parse" "$manifest" 2>/dev/null | jq '.layers | length' 2>/dev/null || printf '%s\n' 0
}

# Build all platform single-exe binaries in the driver tree.
driver_soup_single_exe_build() {
    local driver="${1:?}"
    local bun="${2:-${BUN:-$HOME/.bun/bin/bun}}"
    echo "soup-artifact: running bun build:single-exe:all in $driver ..."
    if ! (cd "$driver" && "$bun" run build:single-exe:all); then
        echo "ERROR: bun build:single-exe:all failed in $driver" >&2
        return 1
    fi
    return 0
}

# Publish dist-exe outputs + manifest. Idempotent for the same tag (rm -rf dest first).
driver_soup_single_exe_publish() {
    local driver="${1:?}"
    local primary="${2:-${HAPI_PRIMARY:-$HOME/coding/hapi}}"
    local manifest="${3:-}"
    local parse="${4:-}"
    local bun="${5:-${BUN:-$HOME/.bun/bin/bun}}"
    local dry_run="${6:-0}"

    if ! driver_soup_single_exe_host_ok; then
        echo "soup-artifact: skip — host is not oos soup foundry (/var/lib/hapi missing or not writable)" >&2
        return 0
    fi

    if [[ -z "$manifest" ]]; then
        manifest="$primary/config/driver-manifest.yaml"
    fi
    parse="${parse:-$primary/scripts/tooling/parse-driver-manifest.mjs}"

    local tag root dest dist_exe
    tag="$(driver_soup_single_exe_tag "$driver")"
    root="$(driver_soup_single_exe_artifacts_root)"
    dest="$root/$tag"
    dist_exe="$driver/cli/dist-exe"

    local tip_sha tree_oid layer_count web_hash protocol_version published_at
    tip_sha="$(git -C "$driver" rev-parse HEAD)"
    tree_oid="$(git -C "$driver" rev-parse 'HEAD^{tree}')"
    layer_count="$(driver_soup_single_exe_layer_count "$manifest" "$parse")"
    web_hash="$(driver_soup_single_exe_web_dist_hash "$driver" || true)"
    protocol_version="$(driver_soup_single_exe_protocol_version "$driver")"
    published_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    echo "soup-artifact: tag=$tag tip=${tip_sha:0:12} layers=$layer_count protocolVersion=$protocol_version"

    if [[ "$dry_run" == "1" ]]; then
        echo "soup-artifact: dry-run — would publish to $dest"
        return 0
    fi

    if [[ ! -d "$dist_exe" ]]; then
        echo "soup-artifact: dist-exe missing — building ..."
        if ! driver_soup_single_exe_build "$driver" "$bun"; then
            return 1
        fi
    fi

    if [[ ! -d "$dist_exe" ]]; then
        echo "ERROR: soup-artifact: expected $dist_exe after build" >&2
        return 1
    fi

    mkdir -p "$root"
    rm -rf "$dest"
    mkdir -p "$dest"

    local binaries_json='[]'
    local target platform_dir outfile binary_name sha size
    shopt -s nullglob
    for target_dir in "$dist_exe"/bun-*; do
        [[ -d "$target_dir" ]] || continue
        target="$(basename "$target_dir")"
        driver_soup_single_exe_parse_target "$target"
        platform_dir="$(driver_soup_single_exe_target_dir "$target")"
        if [[ -f "$target_dir/hapi.exe" ]]; then
            binary_name=hapi.exe
        elif [[ -f "$target_dir/hapi" ]]; then
            binary_name=hapi
        else
            echo "WARNING: soup-artifact: no binary in $target_dir — skip" >&2
            continue
        fi
        outfile="$target_dir/$binary_name"
        mkdir -p "$dest/$platform_dir"
        cp -f "$outfile" "$dest/$platform_dir/$binary_name"
        chmod +x "$dest/$platform_dir/$binary_name" 2>/dev/null || true
        sha="$(driver_soup_single_exe_sha256_file "$dest/$platform_dir/$binary_name")"
        size="$(wc -c <"$dest/$platform_dir/$binary_name" | tr -d ' ')"

        binaries_json="$(jq -c \
            --arg target "$target" \
            --arg platform "$PLATFORM" \
            --arg arch "$ARCH" \
            --arg variant "$VARIANT" \
            --arg relpath "$platform_dir/$binary_name" \
            --arg sha256 "$sha" \
            --argjson sizeBytes "$size" \
            '. + [{target: $target, platform: $platform, arch: $arch, variant: $variant, path: $relpath, sha256: $sha256, sizeBytes: $sizeBytes}]' \
            <<<"$binaries_json")"

        # Per-binary sidecar (upgrade-artifacts JSON shape).
        jq -n \
            --arg version "$tag" \
            --arg platform "$PLATFORM" \
            --arg arch "$ARCH" \
            --arg path "$dest/$platform_dir/$binary_name" \
            --arg sha256 "$sha" \
            --argjson sizeBytes "$size" \
            '{version: $version, platform: $platform, arch: $arch, path: $path, sha256: $sha256, sizeBytes: $sizeBytes}' \
            >"$dest/$platform_dir/${binary_name}.json"
    done
    shopt -u nullglob

    if [[ "$binaries_json" == '[]' ]]; then
        echo "ERROR: soup-artifact: no binaries published from $dist_exe" >&2
        rm -rf "$dest"
        return 1
    fi

    jq -n \
        --arg schema "1" \
        --arg tag "$tag" \
        --arg composedTipSha "$tip_sha" \
        --arg composedTreeOid "$tree_oid" \
        --argjson layerCount "$layer_count" \
        --arg webDistIndexSha256 "$web_hash" \
        --argjson protocolVersion "$protocol_version" \
        --arg publishedAt "$published_at" \
        --arg publisherHost "$(hostname -s 2>/dev/null || hostname)" \
        --arg driverPath "$(readlink -f "$driver" 2>/dev/null || echo "$driver")" \
        --argjson binaries "$binaries_json" \
        '{
            schema: ($schema|tonumber),
            tag: $tag,
            composedTipSha: $composedTipSha,
            composedTreeOid: $composedTreeOid,
            layerCount: $layerCount,
            webDistIndexSha256: $webDistIndexSha256,
            protocolVersion: $protocolVersion,
            publishedAt: $publishedAt,
            publisherHost: $publisherHost,
            driverPath: $driverPath,
            binaries: $binaries
        }' >"$dest/manifest.json"

    ln -sfn "$tag" "$root/latest"
    printf '%s\n' "$tag" >"$root/latest-tag.txt"

    # Fleet SCP playbook: mirror primary linux x64 baseline into upgrade-artifacts.
    local upgrade_root="/var/lib/hapi/upgrade-artifacts"
    local linux_bin="$dest/linux-x64-baseline/hapi"
    if [[ -f "$linux_bin" && -d "$upgrade_root" ]]; then
        local fleet_name="${tag}-linux-x64-baseline"
        cp -f "$linux_bin" "$upgrade_root/$fleet_name"
        chmod +x "$upgrade_root/$fleet_name"
        jq -n \
            --arg version "$tag" \
            --arg platform linux \
            --arg arch x64 \
            --arg path "$upgrade_root/$fleet_name" \
            --arg sha256 "$(driver_soup_single_exe_sha256_file "$upgrade_root/$fleet_name")" \
            --argjson sizeBytes "$(wc -c <"$upgrade_root/$fleet_name" | tr -d ' ')" \
            '{version: $version, platform: $platform, arch: $arch, path: $path, sha256: $sha256, sizeBytes: $sizeBytes}' \
            >"$upgrade_root/$fleet_name.json"
        echo "soup-artifact: fleet mirror $upgrade_root/$fleet_name"
    fi

    echo "soup-artifact: published $dest"
    echo "soup-artifact: fetch linux x64: $dest/linux-x64-baseline/hapi"
    echo "soup-artifact: manifest: $dest/manifest.json"
    echo "soup-artifact: latest symlink: $root/latest"
    return 0
}
