#!/usr/bin/env bash
# Resolve driver-manifest.yaml.
# Canonical recipe: <repo>/config/driver-manifest.yaml (tracked in fork main).
# Optional override: HAPI_DRIVER_MANIFEST=/path/to/manifest.yaml
# Optional generated mirror (never the editor of truth): 
#   scripts/tooling/hapi-manifest-mirror-to-config.sh → ~/.config/hapi/driver-manifest.yaml
# Do NOT copy ~/.config → repo (inverted sync deleted open-PR layers in 1d4644037).
# Do NOT fall back to ~/.config — a stale mirror once composed soup on upstream/main
# after the recipe flipped to origin/main (2026-10-06).

hapi_manifest_path() {
    local primary="${1:-${HAPI_PRIMARY:-$HOME/coding/hapi}}"

    if [[ -n "${HAPI_DRIVER_MANIFEST:-}" ]]; then
        echo "$HAPI_DRIVER_MANIFEST"
        return 0
    fi

    echo "$primary/config/driver-manifest.yaml"
}
