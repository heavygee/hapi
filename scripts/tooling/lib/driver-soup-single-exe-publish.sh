#!/usr/bin/env bash
# driver-soup-single-exe-publish.sh — build + publish soup single-exe fleet artifacts.
#
# Stage 0 of docs/plans/2026-09-04-fleet-vm-swap-strategy.md: after a verified
# soup promote on oos-linux, produce self-contained hapi binaries (CLI+hub+runner,
# embedded web UI) tagged hapi-soup-v<YYYY.MM.DD>-<7-char-tip>.
#
# Publish root (durable, on oos): /var/lib/hapi/soup-artifacts/<tag>/
#   latest -> <tag>           (dogfood tip — remat thrash OK)
#   latest-tag.txt
#   fleet-latest -> <tag>     (operator seal only — see hapi-fleet-seal / contract)
#   fleet-latest-tag.txt
#   manifest.json             (composed tip, layer count, web/dist hash, protocolVersion)
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
#   HAPI_SOUP_REUSE_DIST_EXE=1  dangerous escape hatch: publish existing dist-exe without tip-stamp rebuild
#   HAPI_FLEET_GH_CHANNEL_TAG   default hapi-fleet (moving Layer A channel; never 'latest')
#   HAPI_SKIP_FLEET_GITHUB_CHANNEL=1  skip GH channel upsert on seal (tests / offline)
#   HAPI_SKIP_FLEET_DISPATCH=1  skip per-target dispatch after seal (#258)
#
# Supply-chain invariant: dist-exe/.composed-tip-sha must equal driver HEAD before
# publish copies binaries. Rebuild was skipping compile whenever dist-exe/ already
# existed (oos 2026-10-06..12), re-tagging stale Oct-8 bytes under new tips.

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

driver_soup_single_exe_tip_stamp_path() {
    local driver="${1:?}"
    printf '%s\n' "$driver/cli/dist-exe/.composed-tip-sha"
}

# 0 = needs rebuild, 1 = tip stamp already matches HEAD (safe reuse).
driver_soup_single_exe_needs_rebuild() {
    local driver="${1:?}"
    local tip_sha="${2:?}"
    local stamp stamped=""
    stamp="$(driver_soup_single_exe_tip_stamp_path "$driver")"
    if [[ "${HAPI_SOUP_REUSE_DIST_EXE:-}" == "1" ]]; then
        return 1
    fi
    if [[ ! -d "$driver/cli/dist-exe" ]]; then
        return 0
    fi
    if [[ ! -f "$stamp" ]]; then
        return 0
    fi
    stamped="$(tr -d '[:space:]' <"$stamp" 2>/dev/null || true)"
    if [[ -z "$stamped" || "$stamped" != "$tip_sha" ]]; then
        return 0
    fi
    return 1
}

# Build all platform single-exe binaries in the driver tree; stamp tip SHA.
driver_soup_single_exe_build() {
    local driver="${1:?}"
    local bun="${2:-${BUN:-$HOME/.bun/bin/bun}}"
    local tip_sha stamp
    tip_sha="$(git -C "$driver" rev-parse HEAD)"
    echo "soup-artifact: running bun build:single-exe:all in $driver ..."
    if ! (cd "$driver" && "$bun" run build:single-exe:all); then
        echo "ERROR: bun build:single-exe:all failed in $driver" >&2
        return 1
    fi
    mkdir -p "$driver/cli/dist-exe"
    stamp="$(driver_soup_single_exe_tip_stamp_path "$driver")"
    printf '%s\n' "$tip_sha" >"$stamp"
    echo "soup-artifact: wrote tip stamp ${tip_sha:0:12} → $stamp"
    return 0
}

# Rebuild when dist-exe is missing or stamped for a different composed tip.
driver_soup_single_exe_ensure_fresh() {
    local driver="${1:?}"
    local bun="${2:-${BUN:-$HOME/.bun/bin/bun}}"
    local tip_sha stamp stamped=""
    tip_sha="$(git -C "$driver" rev-parse HEAD)"
    stamp="$(driver_soup_single_exe_tip_stamp_path "$driver")"

    if [[ "${HAPI_SOUP_REUSE_DIST_EXE:-}" == "1" ]]; then
        echo "WARNING: soup-artifact: HAPI_SOUP_REUSE_DIST_EXE=1 — publishing existing dist-exe without rebuild" >&2
        return 0
    fi

    if ! driver_soup_single_exe_needs_rebuild "$driver" "$tip_sha"; then
        echo "soup-artifact: dist-exe tip stamp matches HEAD ${tip_sha:0:12} — reuse"
        return 0
    fi

    if [[ -f "$stamp" ]]; then
        stamped="$(tr -d '[:space:]' <"$stamp" 2>/dev/null || true)"
    fi
    if [[ -d "$driver/cli/dist-exe" && -n "$stamped" && "$stamped" != "$tip_sha" ]]; then
        echo "soup-artifact: dist-exe tip stamp stale (have=${stamped:0:12} want=${tip_sha:0:12}) — rebuilding"
    elif [[ -d "$driver/cli/dist-exe" ]]; then
        echo "soup-artifact: dist-exe unstamped — rebuilding for tip ${tip_sha:0:12}"
    else
        echo "soup-artifact: dist-exe missing — building for tip ${tip_sha:0:12}"
    fi

    if ! driver_soup_single_exe_build "$driver" "$bun"; then
        return 1
    fi

    stamped="$(tr -d '[:space:]' <"$stamp" 2>/dev/null || true)"
    if [[ "$stamped" != "$tip_sha" ]]; then
        echo "ERROR: soup-artifact: tip stamp mismatch after build (have=${stamped:0:12} want=${tip_sha:0:12})" >&2
        return 1
    fi
    return 0
}

# Verify tip dir manifest matches on-disk binary digests (seal / watcher invariant).
# Returns 0 when every binaries[].path exists and sha256 matches.
driver_soup_fleet_seal_verify_tip() {
    local tip_dir="${1:?}"
    local manifest entry path want got n
    manifest="$tip_dir/manifest.json"
    if [[ ! -f "$manifest" ]]; then
        echo "ERROR: fleet-seal: missing manifest.json in $tip_dir" >&2
        return 1
    fi
    n="$(jq '.binaries | length' "$manifest" 2>/dev/null || echo 0)"
    if [[ "$n" -lt 1 ]]; then
        echo "ERROR: fleet-seal: manifest has no binaries[]" >&2
        return 1
    fi
    local i=0
    while [[ "$i" -lt "$n" ]]; do
        path="$(jq -r --argjson i "$i" '.binaries[$i].path // empty' "$manifest")"
        want="$(jq -r --argjson i "$i" '.binaries[$i].sha256 // empty' "$manifest")"
        if [[ -z "$path" || -z "$want" ]]; then
            echo "ERROR: fleet-seal: binaries[$i] missing path/sha256" >&2
            return 1
        fi
        if [[ ! -f "$tip_dir/$path" ]]; then
            echo "ERROR: fleet-seal: missing binary $tip_dir/$path" >&2
            return 1
        fi
        got="$(driver_soup_single_exe_sha256_file "$tip_dir/$path")"
        if [[ "${got,,}" != "${want,,}" ]]; then
            echo "ERROR: fleet-seal: digest mismatch for $path" >&2
            echo "       manifest $want" >&2
            echo "       on-disk  $got" >&2
            return 1
        fi
        i=$((i + 1))
    done
    return 0
}

# Moving GitHub Releases channel for off-estate Layer A pollers (#256).
# Dated tips stay immutable; this channel is deleted+recreated on each seal.
driver_soup_fleet_github_channel_tag() {
    printf '%s\n' "${HAPI_FLEET_GH_CHANNEL_TAG:-hapi-fleet}"
}

# Durable poll URL Layer A / pet install should use (primary, not fallback).
driver_soup_fleet_github_manifest_url() {
    local repo channel
    repo="$(driver_soup_single_exe_github_repo)"
    channel="$(driver_soup_fleet_github_channel_tag)"
    printf 'https://github.com/%s/releases/download/%s/manifest.json\n' "$repo" "$channel"
}

# Mirror sealed tip bytes onto the moving GH channel release (mandatory on seal).
# Kill-criteria: never use releases/latest; digests must match tip; channel ≠ dated tip tag.
#
# Upsert (never delete+recreate): GitHub tag deletion is eventually-consistent —
# delete-then-recreate-same-tag can orphan the new release as a draft so
# releases/download/<channel>/… 404s (cli/cli#8458). Pattern: force-move the
# tag ref, create-or-heal a published release with --latest=false, then
# `gh release upload --clobber` stable asset names.
#
# Usage: driver_soup_fleet_seal_github_channel <tip_dir> <sealed_tip_tag> [--dry-run]
driver_soup_fleet_seal_github_channel() {
    local tip_dir="${1:?}"
    local sealed_tag="${2:?}"
    local dry_run=0
    shift 2 || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=1; shift ;;
            *) echo "ERROR: fleet-seal-gh: unexpected arg: $1" >&2; return 2 ;;
        esac
    done

    if [[ "${HAPI_SKIP_FLEET_GITHUB_CHANNEL:-}" == "1" ]]; then
        echo "fleet-seal: skip GitHub channel mirror (HAPI_SKIP_FLEET_GITHUB_CHANNEL=1)"
        return 0
    fi

    local channel repo tip_sha staging
    channel="$(driver_soup_fleet_github_channel_tag)"
    repo="$(driver_soup_single_exe_github_repo)"
    tip_sha="$(jq -r '.composedTipSha // empty' "$tip_dir/manifest.json")"

    if [[ "$channel" == "$sealed_tag" ]]; then
        echo "ERROR: fleet-seal: channel tag must not equal dated tip tag ($channel)" >&2
        return 1
    fi
    if [[ "$channel" == latest ]]; then
        echo "ERROR: fleet-seal: channel tag must not be 'latest' (dogfood thrash)" >&2
        return 1
    fi
    if [[ -z "$tip_sha" ]]; then
        echo "ERROR: fleet-seal: manifest missing composedTipSha (needed to point channel tag)" >&2
        return 1
    fi

    local -a files=()
    staging="$(mktemp -d "${TMPDIR:-/tmp}/hapi-fleet-channel.XXXXXX")"
    if ! driver_soup_single_exe_stage_github_assets "$tip_dir" "$staging" files; then
        rm -rf "$staging"
        echo "ERROR: fleet-seal: cannot stage GitHub assets from $tip_dir" >&2
        return 1
    fi

    local manifest_url
    manifest_url="$(driver_soup_fleet_github_manifest_url)"
    echo "fleet-seal: GitHub channel ${repo}@${channel} ← sealed tip ${sealed_tag}"
    echo "fleet-seal: Layer A poll URL: ${manifest_url}"

    if [[ "$dry_run" == "1" ]]; then
        echo "fleet-seal: dry-run OK (would upsert GH release ${channel} with ${#files[@]} asset(s))"
        rm -rf "$staging"
        return 0
    fi

    if ! command -v gh >/dev/null 2>&1; then
        rm -rf "$staging"
        echo "ERROR: fleet-seal: gh CLI required to mirror channel ${channel}" >&2
        return 1
    fi

    # Resolve a commit the GH API accepts as tag target (fork tip may lag soup tip).
    local target_sha=""
    if gh api "repos/${repo}/commits/${tip_sha}" >/dev/null 2>&1; then
        target_sha="$tip_sha"
    else
        echo "WARN: fleet-seal: tip ${tip_sha:0:12} not on ${repo}; channel tag will target default branch tip" >&2
        target_sha="$(gh api "repos/${repo}/commits/main" --jq .sha 2>/dev/null || true)"
        if [[ -z "$target_sha" ]]; then
            rm -rf "$staging"
            echo "ERROR: fleet-seal: cannot resolve a commit for channel tag ${channel}" >&2
            return 1
        fi
    fi

    # Atomic force-update of the moving tag — no async-delete window.
    if ! gh api -X PATCH "repos/${repo}/git/refs/tags/${channel}" \
        -f sha="$target_sha" -F force=true >/dev/null 2>&1; then
        if ! gh api -X POST "repos/${repo}/git/refs" \
            -f ref="refs/tags/${channel}" -f sha="$target_sha" >/dev/null; then
            rm -rf "$staging"
            echo "ERROR: fleet-seal: failed to create/move git tag ${channel}" >&2
            return 1
        fi
    fi

    local notes notes_file
    notes="**Fleet seal channel** (\`${channel}\`) — moving pointer for Layer A / pet installs."
    notes+=$'\n\n'"**Sealed tip:** \`${sealed_tag}\`"
    notes+=$'\n'"**Composed tip:** \`${tip_sha}\`"
    notes+=$'\n\n'"Poll: \`${manifest_url}\`"
    notes+=$'\n'"Digest-only newness — never treat this channel name alone as sufficiency."
    notes+=$'\n\n'"FORK-ONLY fleet product (\`heavygee/hapi\`) — not upstream-bound."

    notes_file="$(mktemp "${TMPDIR:-/tmp}/hapi-fleet-notes.XXXXXX")"
    printf '%s\n' "$notes" >"$notes_file"

    local gh_rc=0
    if gh release view "$channel" --repo "$repo" >/dev/null 2>&1; then
        # Heal orphaned drafts; keep channel off the repo "Latest" badge.
        gh release edit "$channel" \
            --repo "$repo" \
            --draft=false \
            --latest=false \
            --target "$target_sha" \
            --title "Fleet seal (→ ${sealed_tag})" \
            --notes-file "$notes_file" || gh_rc=$?
    else
        gh release create "$channel" \
            --repo "$repo" \
            --title "Fleet seal (→ ${sealed_tag})" \
            --notes-file "$notes_file" \
            --latest=false \
            --target "$target_sha" || gh_rc=$?
    fi

    if [[ "$gh_rc" -eq 0 ]]; then
        # Stable asset names; --clobber refreshes bytes on each seal.
        # Prefer deleting manifest.json first — GH CDN can keep stale bytes for
        # the same download URL after a bare --clobber (oos 2026-10-14 seal).
        local mid
        mid="$(gh api "repos/${repo}/releases/tags/${channel}" \
            --jq '.assets[]|select(.name=="manifest.json").id' 2>/dev/null || true)"
        if [[ -n "$mid" ]]; then
            gh api -X DELETE "repos/${repo}/releases/assets/${mid}" >/dev/null 2>&1 || true
        fi
        gh release upload "$channel" \
            --repo "$repo" \
            --clobber \
            "${files[@]}" || gh_rc=$?
    fi

    rm -f "$notes_file"
    # Keep staging until public CDN verify succeeds (need manifest path).
    local staging_manifest="$staging/manifest.json"

    if [[ "$gh_rc" -ne 0 ]]; then
        rm -rf "$staging"
        echo "ERROR: fleet-seal: GH channel upsert failed for ${channel}" >&2
        return 1
    fi

    # Refuse draft (assets would 404 on public download URLs).
    local is_draft
    is_draft="$(gh release view "$channel" --repo "$repo" --json isDraft --jq .isDraft 2>/dev/null || echo true)"
    if [[ "$is_draft" == "true" ]]; then
        rm -rf "$staging"
        echo "ERROR: fleet-seal: channel release ${channel} is draft — public poll URL would 404" >&2
        return 1
    fi

    # Public download URL must eventually serve the sealed tip (Layer A poll path).
    # API asset view can be fresh while releases/download/… CDN is stale.
    local want_tag public_tag i healed=0
    want_tag="$(jq -r '.tag // empty' "$staging_manifest")"
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        public_tag="$(curl -fsSL "$manifest_url" 2>/dev/null | jq -r '.tag // empty' || true)"
        if [[ -n "$want_tag" && "$public_tag" == "$want_tag" ]]; then
            healed=1
            break
        fi
        if [[ "$i" -eq 3 || "$i" -eq 7 ]]; then
            # Re-delete+upload manifest to bust CDN mid-wait.
            mid="$(gh api "repos/${repo}/releases/tags/${channel}" \
                --jq '.assets[]|select(.name=="manifest.json").id' 2>/dev/null || true)"
            if [[ -n "$mid" ]]; then
                gh api -X DELETE "repos/${repo}/releases/assets/${mid}" >/dev/null 2>&1 || true
            fi
            gh release upload "$channel" --repo "$repo" --clobber "$staging_manifest" >/dev/null 2>&1 || true
            echo "fleet-seal: CDN still stale (got ${public_tag:-empty}); re-uploaded manifest (try $i)"
        fi
        sleep 5
    done
    rm -rf "$staging"
    if [[ "$healed" != "1" ]]; then
        echo "ERROR: fleet-seal: public $manifest_url still not tag=$want_tag after CDN wait" >&2
        echo "       API may be fresh; Layer A pollers use the public URL — fix CDN / retry upload" >&2
        return 1
    fi

    echo "fleet-seal: GitHub channel OK → ${manifest_url} (public tag=${public_tag})"
    return 0
}

# Point soup-artifacts/fleet-latest at an already-published tip (operator seal).
# Does NOT move dogfood `latest`. Digest-verify tip before flipping.
# Also mirrors sealed tip onto GH moving channel `hapi-fleet` (#256) — mandatory
# unless HAPI_SKIP_FLEET_GITHUB_CHANNEL=1 (unit tests / offline).
#
# Usage: driver_soup_fleet_seal [tag] [--dry-run]
#   tag omitted → current latest-tag.txt / latest symlink target
driver_soup_fleet_seal() {
    local root tag tip_dir dry_run=0
    root="$(driver_soup_single_exe_artifacts_root)"
    tag=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=1; shift ;;
            -h|--help)
                echo "Usage: driver_soup_fleet_seal [tag] [--dry-run]" >&2
                return 2
                ;;
            *)
                if [[ -n "$tag" ]]; then
                    echo "ERROR: fleet-seal: unexpected arg: $1" >&2
                    return 2
                fi
                tag="$1"
                shift
                ;;
        esac
    done

    if [[ -z "$tag" ]]; then
        if [[ -f "$root/latest-tag.txt" ]]; then
            tag="$(tr -d '[:space:]' <"$root/latest-tag.txt")"
        elif [[ -L "$root/latest" ]]; then
            tag="$(readlink "$root/latest")"
        fi
    fi
    if [[ -z "$tag" ]]; then
        echo "ERROR: fleet-seal: no tag (pass hapi-soup-v… or publish a latest tip first)" >&2
        return 1
    fi
    if [[ ! "$tag" =~ ^hapi-soup-v ]]; then
        echo "ERROR: fleet-seal: tag must start with hapi-soup-v (got: $tag)" >&2
        return 1
    fi

    tip_dir="$root/$tag"
    if [[ ! -d "$tip_dir" ]]; then
        echo "ERROR: fleet-seal: tip dir missing: $tip_dir" >&2
        return 1
    fi

    if ! driver_soup_fleet_seal_verify_tip "$tip_dir"; then
        return 1
    fi

    local tip_sha
    tip_sha="$(jq -r '.composedTipSha // empty' "$tip_dir/manifest.json")"
    echo "fleet-seal: tag=$tag tip=${tip_sha:0:12} root=$root"

    if [[ "$dry_run" == "1" ]]; then
        echo "fleet-seal: dry-run OK (would point fleet-latest → $tag)"
        driver_soup_fleet_seal_github_channel "$tip_dir" "$tag" --dry-run || return 1
        local dispatch_script
        dispatch_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hapi-fleet-seal-dispatch.sh"
        if [[ -x "$dispatch_script" ]]; then
            bash "$dispatch_script" "$tag" --dry-run || return 1
        fi
        return 0
    fi

    # Relative symlink (same as latest) so the artifacts root is relocatable.
    ln -sfn "$tag" "$root/fleet-latest"
    printf '%s\n' "$tag" >"$root/fleet-latest-tag.txt"
    echo "fleet-seal: fleet-latest → $tag"
    echo "fleet-seal: fleet-latest-tag.txt written"
    echo "fleet-seal: manifest $tip_dir/manifest.json"

    # Off-estate Layer A / pets: GH channel is primary (not optional mirror).
    if ! driver_soup_fleet_seal_github_channel "$tip_dir" "$tag"; then
        echo "ERROR: fleet-seal: local fleet-latest updated but GitHub channel mirror FAILED" >&2
        echo "       fix gh auth / retry: hapi-fleet-seal $tag" >&2
        return 1
    fi

    # Per-target-type dispatch (#258): estate push / Layer A verify / cattle plan.
    local dispatch_script
    dispatch_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hapi-fleet-seal-dispatch.sh"
    if [[ -x "$dispatch_script" ]]; then
        if ! bash "$dispatch_script" "$tag"; then
            echo "ERROR: fleet-seal: pointers moved but target dispatch FAILED" >&2
            echo "       retry: hapi-fleet-seal-dispatch $tag" >&2
            return 1
        fi
    else
        echo "WARN: fleet-seal: dispatch script missing at $dispatch_script" >&2
    fi
    return 0
}

# Refuse to re-tag identical binary bytes under a new composed tip (the 2026-10
# silent-stale failure mode). Compares against the current latest symlink target
# before it is flipped.
driver_soup_single_exe_assert_not_retagging_stale() {
    local dest="${1:?}"
    local tip_sha="${2:?}"
    local root prev_manifest prev_tip prev_bin new_bin name prev_sha new_sha
    root="$(driver_soup_single_exe_artifacts_root)"
    prev_manifest="$root/latest/manifest.json"
    [[ -f "$prev_manifest" ]] || return 0
    prev_tip="$(jq -r '.composedTipSha // empty' "$prev_manifest" 2>/dev/null || true)"
    [[ -n "$prev_tip" ]] || return 0
    if [[ "$prev_tip" == "$tip_sha" ]]; then
        # Same tip republish (e.g. fixing a bad prior upload) — allow digest churn.
        return 0
    fi
    shopt -s nullglob
    for prev_bin in "$root/latest"/*/hapi "$root/latest"/*/hapi.exe; do
        [[ -f "$prev_bin" ]] || continue
        name="$(basename "$(dirname "$prev_bin")")/$(basename "$prev_bin")"
        new_bin="$dest/$name"
        [[ -f "$new_bin" ]] || continue
        prev_sha="$(driver_soup_single_exe_sha256_file "$prev_bin")"
        new_sha="$(driver_soup_single_exe_sha256_file "$new_bin")"
        if [[ "$prev_sha" == "$new_sha" ]]; then
            echo "ERROR: soup-artifact: binary $name sha256 unchanged across tip change" >&2
            echo "       prev tip ${prev_tip:0:12} → new tip ${tip_sha:0:12}" >&2
            echo "       digest $prev_sha" >&2
            echo "       Refuse to publish: compile did not produce fresh bytes (supply-chain)." >&2
            echo "       Rebuild: hapi-soup-publish-single-exe --build-only && retry publish." >&2
            shopt -u nullglob
            return 1
        fi
    done
    shopt -u nullglob
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

    # ALWAYS ensure tip-stamped binaries (do not skip compile just because dist-exe exists).
    if ! driver_soup_single_exe_ensure_fresh "$driver" "$bun"; then
        return 1
    fi

    if [[ ! -d "$dist_exe" ]]; then
        echo "ERROR: soup-artifact: expected $dist_exe after ensure_fresh" >&2
        return 1
    fi
    local stamp_check
    stamp_check="$(tr -d '[:space:]' <"$(driver_soup_single_exe_tip_stamp_path "$driver")" 2>/dev/null || true)"
    if [[ "${HAPI_SOUP_REUSE_DIST_EXE:-}" != "1" && "$stamp_check" != "$tip_sha" ]]; then
        echo "ERROR: soup-artifact: refusing publish — dist-exe tip stamp ($stamp_check) != HEAD ($tip_sha)" >&2
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

    if ! driver_soup_single_exe_assert_not_retagging_stale "$dest" "$tip_sha"; then
        rm -rf "$dest"
        return 1
    fi

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
