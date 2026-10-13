#!/usr/bin/env bash
# Operator fleet seal — point soup-artifacts/fleet-latest at a published tip,
# upsert the GitHub moving channel `hapi-fleet` (Layer A primary poll), then
# dispatch per-target-type actions (#258 registry).
#
# Canon: docs/plans/2026-10-13-fleet-seal-contract.md (#256/#258)
# FORK-ONLY fleet product — not upstream-bound. Never moves dogfood `latest`.
#
# Usage:
#   hapi-fleet-seal                     # seal current latest tip
#   hapi-fleet-seal hapi-soup-v…        # seal a specific published tag
#   hapi-fleet-seal --dry-run [tag]     # verify digests + GH channel plan
#   HAPI_SOUP_ARTIFACTS_ROOT=/path hapi-fleet-seal
#   HAPI_SKIP_FLEET_GITHUB_CHANNEL=1    # local-only (tests / break-glass)
#   HAPI_SKIP_FLEET_DISPATCH=1          # skip estate/Layer A/cattle dispatch
#
# Spoken gate (lifecycle): only after operator says fleet seal /
# good enough for fleet / seal tip <tag>. Agents must not invent seal.
#
set -euo pipefail

LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/driver-soup-single-exe-publish.sh
source "$LIB_DIR/driver-soup-single-exe-publish.sh"

DRY_RUN=0
TAG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help)
            sed -n '2,16p' "$0"
            exit 0
            ;;
        *)
            if [[ -n "$TAG" ]]; then
                echo "Unknown extra arg: $1" >&2
                exit 2
            fi
            TAG="$1"
            shift
            ;;
    esac
done

args=()
[[ -n "$TAG" ]] && args+=("$TAG")
[[ "$DRY_RUN" == "1" ]] && args+=(--dry-run)

driver_soup_fleet_seal "${args[@]}"
