#!/usr/bin/env bash
# Build + publish soup single-exe fleet artifacts (Stage 0 golden artifact).
#
# Normally invoked automatically by hapi-driver-rebuild --build-web --verify on
# oos-linux. Use this script for manual publishes (e.g. Antevorta first install).
#
# Usage:
#   hapi-soup-publish-single-exe                    # driver @ ~/coding/hapi/driver
#   hapi-soup-publish-single-exe /path/to/driver    # explicit tree
#   hapi-soup-publish-single-exe --dry-run          # tag + paths only, no build
#   hapi-soup-publish-single-exe --build-only       # build dist-exe, no publish
#
set -euo pipefail

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
BUN="${BUN:-$HOME/.bun/bin/bun}"
LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/hapi-manifest-path.sh
source "$LIB_DIR/hapi-manifest-path.sh"
# shellcheck source=lib/driver-soup-single-exe-publish.sh
source "$LIB_DIR/driver-soup-single-exe-publish.sh"

DRY_RUN=0
BUILD_ONLY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --build-only) BUILD_ONLY=1; shift ;;
        -h|--help)
            sed -n '2,12p' "$0"
            exit 0
            ;;
        *)
            if [[ -d "$1" ]]; then
                DRIVER="$1"
                shift
            else
                echo "Unknown option or missing directory: $1" >&2
                exit 2
            fi
            ;;
    esac
done

MANIFEST="$(hapi_manifest_path "$PRIMARY")"
PARSE="$PRIMARY/scripts/tooling/parse-driver-manifest.mjs"

if ! git -C "$DRIVER" rev-parse HEAD >/dev/null 2>&1; then
    echo "ERROR: not a git worktree: $DRIVER" >&2
    exit 1
fi

tag="$(driver_soup_single_exe_tag "$DRIVER")"
echo "soup-artifact: driver=$(git -C "$DRIVER" rev-parse --short HEAD) tag=$tag"

if [[ "$DRY_RUN" == "1" ]]; then
    driver_soup_single_exe_publish "$DRIVER" "$PRIMARY" "$MANIFEST" "$PARSE" "$BUN" 1
    exit 0
fi

if [[ "$BUILD_ONLY" == "1" ]]; then
    driver_soup_single_exe_build "$DRIVER" "$BUN"
    exit 0
fi

driver_soup_single_exe_build "$DRIVER" "$BUN"
driver_soup_single_exe_publish "$DRIVER" "$PRIMARY" "$MANIFEST" "$PARSE" "$BUN" 0
