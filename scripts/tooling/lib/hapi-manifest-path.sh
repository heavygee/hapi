#!/usr/bin/env bash
# Resolve driver-manifest.yaml.
# Canonical recipe: <repo>/config/driver-manifest.yaml (tracked in fork main).
# ~/.config/hapi/driver-manifest.yaml is a generated runtime mirror — refresh with
#   scripts/tooling/hapi-manifest-mirror-to-config.sh
# Do NOT copy ~/.config → repo (inverted sync deleted open-PR layers in 1d4644037).

hapi_manifest_path() {
    local primary="${1:-${HAPI_PRIMARY:-$HOME/coding/hapi}}"

    if [[ -n "${HAPI_DRIVER_MANIFEST:-}" ]]; then
        echo "$HAPI_DRIVER_MANIFEST"
        return 0
    fi

    if [[ -f "$primary/config/driver-manifest.yaml" ]]; then
        echo "$primary/config/driver-manifest.yaml"
        return 0
    fi

    echo "${HOME}/.config/hapi/driver-manifest.yaml"
}
