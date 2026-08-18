#!/usr/bin/env bash
# CLI: check manifest removals against OPEN heavygee/hapi PRs.
# Usage:
#   hapi-manifest-drop-gate.sh staged          # git index vs HEAD (pre-commit)
#   hapi-manifest-drop-gate.sh file OLD NEW   # explicit diff
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-manifest-drop-gate.sh
source "$SCRIPT_DIR/lib/hapi-manifest-drop-gate.sh"

if [[ "${HAPI_MANIFEST_DROP_OPEN_PR:-}" == "1" ]]; then
    if [[ ! -t 0 ]]; then
        echo "manifest-drop-gate: HAPI_MANIFEST_DROP_OPEN_PR=1 requires a controlling TTY" >&2
        exit 1
    fi
    if [[ -z "${HAPI_MANIFEST_DROP_ALLOW_BRANCH:-}" ]]; then
        echo "manifest-drop-gate: HAPI_MANIFEST_DROP_OPEN_PR=1 requires HAPI_MANIFEST_DROP_ALLOW_BRANCH=<branch>" >&2
        exit 1
    fi
fi

case "${1:-}" in
    staged)
        hapi_manifest_drop_gate_check_staged "${2:-}"
        ;;
    file)
        [[ $# -eq 3 ]] || { echo "usage: $0 file OLD NEW" >&2; exit 2; }
        hapi_manifest_drop_gate_check_file "$2" "$3"
        ;;
    -h|--help)
        echo "usage: $0 staged | file OLD NEW" >&2
        exit 0
        ;;
    *)
        echo "usage: $0 staged | file OLD NEW" >&2
        exit 2
        ;;
esac
