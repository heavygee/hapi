#!/usr/bin/env bash
# Resolve driver-manifest.yaml.
# Canonical recipe: <repo>/config/driver-manifest.yaml (tracked in fork main).
# Optional override: HAPI_DRIVER_MANIFEST=/path/to/manifest.yaml
# Optional generated mirror (never the editor of truth): 
#   scripts/tooling/hapi-manifest-mirror-to-config.sh → ~/.config/hapi/driver-manifest.yaml
# Do NOT copy ~/.config → repo (inverted sync deleted open-PR layers in 1d4644037).
# Do NOT fall back to ~/.config — a stale mirror once composed soup on upstream/main
# after the recipe flipped to origin/main (2026-10-06).
#
# HAPI_META_MANIFEST may point Meta daily at the ~/.config mirror for *composition*
# (active layers the driver cooks). Provenance questions (DROPPED cites, watch-only
# detection) MUST use hapi_manifest_provenance_path — never the Meta override —
# or a stale mirror silently reclassifies owned merges as third-party (#2526 overlay
# inverse, 2026-11-20).

hapi_manifest_path() {
    local primary="${1:-${HAPI_PRIMARY:-$HOME/coding/hapi}}"

    if [[ -n "${HAPI_DRIVER_MANIFEST:-}" ]]; then
        echo "$HAPI_DRIVER_MANIFEST"
        return 0
    fi

    echo "$primary/config/driver-manifest.yaml"
}

# Repo recipe only — ignores HAPI_META_MANIFEST and HAPI_DRIVER_MANIFEST.
# Use for DROPPED/cite provenance (mw_manifest_pr_cited / watch-only overlay).
hapi_manifest_provenance_path() {
    local primary="${1:-${HAPI_PRIMARY:-$HOME/coding/hapi}}"
    echo "$primary/config/driver-manifest.yaml"
}
