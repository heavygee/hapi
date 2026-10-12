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
#   HAPI_SOUP_ARTIFACTS_KEEP  default 5 — keep newest hapi-soup-v* dirs (+ active latest); prune older after publish
#   HAPI_SKIP_SOUP_ARTIFACTS_PRUNE=1  skip local retention prune
#   HAPI_SKIP_SOUP_SINGLE_EXE=1   skip (rebuild hook respects this)
#   HAPI_SOUP_SINGLE_EXE_REQUIRED=1  fail hard on publish errors (default when hooked from rebuild --verify --build-web)
#   HAPI_SOUP_GITHUB_REPO       default heavygee/hapi (GitHub Releases mirror)
#   HAPI_SKIP_SOUP_GITHUB_RELEASE=1  skip gh release create/upload (local publish only)
#   HAPI_SOUP_GITHUB_RELEASE_REQUIRED=1  fail publish if gh upload fails (default on oos foundry)

driver_soup_single_exe_artifacts_root() {
    printf '%s\n' "${HAPI_SOUP_ARTIFACTS_ROOT:-/var/lib/hapi/soup-artifacts}"
}

# Keep newest N versioned soup artifact dirs. Always preserves `latest` target + keep list.
# Safe to call when root is missing or nearly empty.
driver_soup_single_exe_prune_artifacts() {
    local root keep active removed d
    root="$(driver_soup_single_exe_artifacts_root)"
    keep="${HAPI_SOUP_ARTIFACTS_KEEP:-5}"
    [[ "${HAPI_SKIP_SOUP_ARTIFACTS_PRUNE:-}" == "1" ]] && return 0
    [[ -d "$root" ]] || return 0
    [[ "$keep" =~ ^[0-9]+$ ]] && ((keep >= 1)) || keep=5

    active=""
    if [[ -L "$root/latest" ]]; then
        active="$(readlink -f "$root/latest" 2>/dev/null || true)"
        active="$(basename "${active:-}")"
    elif [[ -f "$root/latest-tag.txt" ]]; then
        active="$(tr -d '[:space:]' <"$root/latest-tag.txt")"
    fi

    mapfile -t all < <(ls -1 "$root" 2>/dev/null | grep '^hapi-soup-v' | sort || true)
    ((${#all[@]} <= keep)) && return 0

    local -a keep_list=()
    local i start=$((${#all[@]} - keep))
    ((start < 0)) && start=0
    for ((i = start; i < ${#all[@]}; i++)); do
        keep_list+=("${all[$i]}")
    done
    if [[ -n "$active" ]]; then
        local found=0 k
        for k in "${keep_list[@]}"; do
            [[ "$k" == "$active" ]] && found=1 && break
        done
        ((found == 0)) && keep_list+=("$active")
    fi

    removed=0
    for d in "${all[@]}"; do
        local skip=0 k
        for k in "${keep_list[@]}"; do
            [[ "$d" == "$k" ]] && skip=1 && break
        done
        ((skip == 1)) && continue
        rm -rf "$root/$d"
        removed=$((removed + 1))
    done
    if ((removed > 0)); then
        echo "soup-artifact: pruned $removed old dir(s); keep=$keep active=${active:-none}"
    fi
    return 0
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

# Previous hapi-soup-v* GitHub release tag (newest excluding current), or empty.
driver_soup_single_exe_previous_release_tag() {
    local repo="${1:?}"
    local current_tag="${2:?}"
    local tag
    # Prefer JSON — default `gh release list` TSV puts the human title in
    # column 1 and the tag in column 3; title also starts with "Soup release".
    while IFS= read -r tag; do
        [[ -n "$tag" ]] || continue
        [[ "$tag" == "$current_tag" ]] && continue
        [[ "$tag" == hapi-soup-v* ]] || continue
        printf '%s\n' "$tag"
        return 0
    done < <(gh release list --repo "$repo" --limit 30 --json tagName -q '.[].tagName' 2>/dev/null || true)
    return 1
}

# Resolve a soup tip SHA from a release tag suffix (…-<7hex>) or release body.
driver_soup_single_exe_tip_from_release_tag() {
    local driver="${1:?}"
    local repo="${2:?}"
    local tag="${3:?}"
    local short body tip

    short="${tag##*-}"
    if [[ "$short" =~ ^[0-9a-f]{7,40}$ ]]; then
        tip="$(git -C "$driver" rev-parse --verify "${short}^{commit}" 2>/dev/null || true)"
        if [[ -n "$tip" ]]; then
            printf '%s\n' "$tip"
            return 0
        fi
    fi

    body="$(gh release view "$tag" --repo "$repo" --json body -q .body 2>/dev/null || true)"
    tip="$(printf '%s\n' "$body" | sed -nE 's/.*[Cc]omposed driver tip: *([0-9a-f]{7,40}).*/\1/p' | head -1)"
    if [[ -n "$tip" ]]; then
        tip="$(git -C "$driver" rev-parse --verify "${tip}^{commit}" 2>/dev/null || true)"
        if [[ -n "$tip" ]]; then
            printf '%s\n' "$tip"
            return 0
        fi
    fi
    return 1
}

# Real release notes: commit subjects between previous soup tip and this tip.
# Soup GitHub tags often target main (tips may be unpublished), so ranges use
# composed tip SHAs from the driver worktree, not tag^{commit} alone.
driver_soup_single_exe_release_notes() {
    local driver="${1:?}"
    local tip_sha="${2:?}"
    local tag="${3:?}"
    local repo="${4:-$(driver_soup_single_exe_github_repo)}"
    local max_commits="${HAPI_SOUP_RELEASE_NOTES_MAX:-80}"

    local notes prev_tag prev_sha range_label log_lines commit_count truncated=0
    notes="Soup single-exe fleet artifact \`${tag}\`."
    notes+=$'\n\n'"**Composed tip:** \`${tip_sha}\`"

    prev_tag=""
    if prev_tag="$(driver_soup_single_exe_previous_release_tag "$repo" "$tag")"; then
        notes+=$'\n'"**Previous:** \`${prev_tag}\`"
        if prev_sha="$(driver_soup_single_exe_tip_from_release_tag "$driver" "$repo" "$prev_tag")"; then
            if git -C "$driver" merge-base --is-ancestor "$prev_sha" "$tip_sha" 2>/dev/null; then
                range_label="${prev_sha:0:12}..${tip_sha:0:12}"
                commit_count="$(git -C "$driver" rev-list --count "${prev_sha}..${tip_sha}" 2>/dev/null || echo 0)"
                log_lines="$(git -C "$driver" log --pretty=format:'- %s (%h)' --no-merges "${prev_sha}..${tip_sha}" 2>/dev/null \
                    | head -n "$max_commits" || true)"
                if [[ -n "$log_lines" ]]; then
                    local shown
                    shown="$(printf '%s\n' "$log_lines" | grep -c . || true)"
                    if [[ "${commit_count:-0}" -gt "$shown" ]]; then
                        truncated=1
                    fi
                    notes+=$'\n\n'"### Changes since previous soup release (\`${range_label}\`, ${commit_count} commit(s))"
                    notes+=$'\n\n'"$log_lines"
                    if [[ "$truncated" == "1" ]]; then
                        notes+=$'\n'"- … and $((commit_count - shown)) more (truncated at ${max_commits})"
                    fi
                else
                    notes+=$'\n\n'"_No non-merge commits between previous tip and this tip (merge-only or identical)._"
                fi
            else
                notes+=$'\n\n'"_Previous tip \`${prev_sha:0:12}\` is not an ancestor of this tip on the driver worktree — skipped changelog range._"
            fi
        else
            notes+=$'\n\n'"_Could not resolve previous tip SHA from \`${prev_tag}\` on this driver — skipped changelog._"
        fi
    else
        notes+=$'\n\n'"_First soup GitHub release (or no prior \`hapi-soup-v*\` tag found) — no changelog range._"
    fi

    notes+=$'\n\n'"Download per-platform binaries as \`hapi-<platform-dir>\` (see \`manifest.json\` for sha256)."
    printf '%s\n' "$notes"
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
    local driver="${4:-}"

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
    # Prefer NOTES.md written beside manifest (hub skew-banner source of truth).
    if [[ -f "$dest/NOTES.md" ]]; then
        notes="$(cat "$dest/NOTES.md")"
    elif [[ -n "$driver" && -n "$tip_sha" ]] && { [[ -d "$driver/.git" ]] || [[ -f "$driver/.git" ]]; }; then
        notes="$(driver_soup_single_exe_release_notes "$driver" "$tip_sha" "$tag" "$repo")"
    else
        notes="Soup single-exe fleet artifact \`${tag}\`."
        if [[ -n "$tip_sha" ]]; then
            notes+=$'\n\n'"**Composed tip:** \`${tip_sha}\`"
        fi
        notes+=$'\n\n'"Download per-platform binaries as \`hapi-<platform-dir>\` (see \`manifest.json\` for sha256)."
    fi

    if [[ -n "$tip_sha" ]] && gh api "repos/${repo}/commits/${tip_sha}" >/dev/null 2>&1; then
        target_args=(--target "$tip_sha")
    fi

    echo "soup-artifact: mirroring ${#files[@]} asset(s) to GitHub Releases ${repo} tag=${tag}"

    local gh_rc=0
    if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
        echo "soup-artifact: release $tag already exists — uploading assets (--clobber) + refreshing notes"
        gh release upload "$tag" --repo "$repo" --clobber "${files[@]}" || gh_rc=$?
        if [[ "$gh_rc" -eq 0 ]]; then
            gh release edit "$tag" --repo "$repo" --notes "$notes" || {
                echo "WARNING: soup-artifact: gh release edit notes failed for $tag (assets uploaded)" >&2
            }
        fi
    else
        # Prefer --notes-file so multiline markdown survives argv quoting.
        local notes_file
        notes_file="$(mktemp "${TMPDIR:-/tmp}/hapi-soup-notes.XXXXXX")"
        printf '%s\n' "$notes" >"$notes_file"
        gh release create "$tag" \
            --repo "$repo" \
            --title "Soup release $tag" \
            --notes-file "$notes_file" \
            "${target_args[@]}" \
            "${files[@]}" || gh_rc=$?
        rm -f "$notes_file"
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

    # Persist the same notes the GitHub release will use so the hub can serve
    # "what's new" on the fleet skew banner without calling gh at runtime (#248).
    local notes_for_disk repo_for_notes
    repo_for_notes="$(driver_soup_single_exe_github_repo)"
    if [[ -n "$tip_sha" ]] && { [[ -d "$driver/.git" ]] || [[ -f "$driver/.git" ]]; }; then
        notes_for_disk="$(driver_soup_single_exe_release_notes "$driver" "$tip_sha" "$tag" "$repo_for_notes")"
    else
        notes_for_disk="Soup single-exe fleet artifact \`${tag}\`."
        if [[ -n "$tip_sha" ]]; then
            notes_for_disk+=$'\n\n'"**Composed tip:** \`${tip_sha}\`"
        fi
        notes_for_disk+=$'\n\n'"Download per-platform binaries as \`hapi-<platform-dir>\` (see \`manifest.json\` for sha256)."
    fi
    printf '%s\n' "$notes_for_disk" >"$dest/NOTES.md"
    echo "soup-artifact: NOTES.md written ($dest/NOTES.md)"

    ln -sfn "$tag" "$root/latest"
    printf '%s\n' "$tag" >"$root/latest-tag.txt"

    # Retention: hot disk fills if every promote keeps forever (oos 2026-10 space relief).
    driver_soup_single_exe_prune_artifacts || echo "WARNING: soup-artifact: prune failed (non-fatal)" >&2

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
    if driver_soup_single_exe_publish_github_release "$dest" "$tag" "$tip_sha" "$driver"; then
        :
    elif [[ "$github_required" == "1" ]]; then
        echo "ERROR: soup-artifact: GitHub Releases mirror failed (required on soup foundry host)" >&2
        return 1
    else
        echo "WARNING: soup-artifact: GitHub Releases mirror failed (non-fatal on this host)" >&2
    fi

    return 0
}
