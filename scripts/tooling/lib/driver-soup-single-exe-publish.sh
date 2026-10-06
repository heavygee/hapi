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
#   HAPI_SOUP_GITHUB_REPO       default heavygee/hapi (GitHub Releases mirror)
#   HAPI_SKIP_SOUP_GITHUB_RELEASE=1  skip gh release create/upload (local publish only)
#   HAPI_SOUP_GITHUB_RELEASE_REQUIRED=1  fail publish if gh upload fails (default on oos foundry)

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

driver_soup_single_exe_github_repo() {
    printf '%s\n' "${HAPI_SOUP_GITHUB_REPO:-heavygee/hapi}"
}

# Flat release asset name for https://github.com/.../releases/latest/download/<name>
driver_soup_single_exe_github_asset_name() {
    local platform_dir="${1:?}"
    local binary_name="${2:?}"
    if [[ "$binary_name" == *.exe ]]; then
        printf 'hapi-%s.exe\n' "$platform_dir"
    else
        printf 'hapi-%s\n' "$platform_dir"
    fi
}

# Stage flat release asset filenames under a temp dir for gh upload.
driver_soup_single_exe_stage_github_assets() {
    local dest="${1:?}"
    local staging="${2:?}"
    local -n out_files="${3:?}"

    rm -rf "$staging"
    mkdir -p "$staging"
    out_files=()

    [[ -f "$dest/manifest.json" ]] || return 1
    cp -f "$dest/manifest.json" "$staging/manifest.json"
    out_files+=("$staging/manifest.json")

    local platform_dir binary_name asset_name
    for platform_dir in "$dest"/*/; do
        [[ -d "$platform_dir" ]] || continue
        platform_dir="${platform_dir%/}"
        platform_dir="${platform_dir##*/}"
        if [[ -f "$dest/$platform_dir/hapi.exe" ]]; then
            binary_name=hapi.exe
        elif [[ -f "$dest/$platform_dir/hapi" ]]; then
            binary_name=hapi
        else
            continue
        fi
        asset_name="$(driver_soup_single_exe_github_asset_name "$platform_dir" "$binary_name")"
        cp -f "$dest/$platform_dir/$binary_name" "$staging/$asset_name"
        chmod +x "$staging/$asset_name" 2>/dev/null || true
        out_files+=("$staging/$asset_name")
    done

    ((${#out_files[@]} >= 2)) || return 1
    return 0
}

# Mirror a published soup-artifact directory to GitHub Releases on heavygee/hapi.
driver_soup_single_exe_publish_github_release() {
    local dest="${1:?}"
    local tag="${2:?}"
    local tip_sha="${3:-}"

    if [[ "${HAPI_SKIP_SOUP_GITHUB_RELEASE:-}" == "1" ]]; then
        echo "soup-artifact: skip GitHub Releases mirror (HAPI_SKIP_SOUP_GITHUB_RELEASE=1)"
        return 0
    fi

    if ! command -v gh >/dev/null 2>&1; then
        echo "ERROR: soup-artifact: gh CLI not found — cannot mirror to GitHub Releases" >&2
        return 1
    fi

    local repo staging files=()
    repo="$(driver_soup_single_exe_github_repo)"
    staging="$(mktemp -d "${TMPDIR:-/tmp}/hapi-soup-gh-release.XXXXXX")"
    if ! driver_soup_single_exe_stage_github_assets "$dest" "$staging" files; then
        rm -rf "$staging"
        echo "ERROR: soup-artifact: no release assets under $dest" >&2
        return 1
    fi

    local notes target_args=()
    notes="Automated soup single-exe publish."
    if [[ -n "$tip_sha" ]]; then
        notes="$notes Composed driver tip: ${tip_sha}."
    fi
    notes="$notes Download per-platform binaries as hapi-<platform-dir> (see manifest.json for sha256)."

    if [[ -n "$tip_sha" ]] && gh api "repos/${repo}/commits/${tip_sha}" >/dev/null 2>&1; then
        target_args=(--target "$tip_sha")
    fi

    echo "soup-artifact: mirroring ${#files[@]} asset(s) to GitHub Releases ${repo} tag=${tag}"

    local gh_rc=0
    if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
        echo "soup-artifact: release $tag already exists — uploading assets (--clobber)"
        gh release upload "$tag" --repo "$repo" --clobber "${files[@]}" || gh_rc=$?
    else
        gh release create "$tag" \
            --repo "$repo" \
            --title "Soup release $tag" \
            --notes "$notes" \
            "${target_args[@]}" \
            "${files[@]}" || gh_rc=$?
    fi
    rm -rf "$staging"

    if [[ "$gh_rc" -ne 0 ]]; then
        echo "ERROR: soup-artifact: gh release mirror failed for $tag" >&2
        return 1
    fi

    echo "soup-artifact: GitHub Releases mirror OK"
    echo "soup-artifact: latest linux x64: https://github.com/${repo}/releases/latest/download/hapi-linux-x64-baseline"
    echo "soup-artifact: manifest: https://github.com/${repo}/releases/latest/download/manifest.json"
    return 0
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

    local github_required=0
    if [[ "${HAPI_SOUP_GITHUB_RELEASE_REQUIRED:-}" == "1" ]] || driver_soup_single_exe_host_ok; then
        github_required=1
    fi
    if driver_soup_single_exe_publish_github_release "$dest" "$tag" "$tip_sha"; then
        :
    elif [[ "$github_required" == "1" ]]; then
        echo "ERROR: soup-artifact: GitHub Releases mirror failed (required on soup foundry host)" >&2
        return 1
    else
        echo "WARNING: soup-artifact: GitHub Releases mirror failed (non-fatal on this host)" >&2
    fi

    return 0
}
