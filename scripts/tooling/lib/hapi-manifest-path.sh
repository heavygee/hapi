#!/usr/bin/env bash
# Resolve driver-manifest.yaml: repo canonical path, legacy ~/.config override.

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
