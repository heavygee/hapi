#!/usr/bin/env bash
# One-way mirror: repo config/driver-manifest.yaml → ~/.config/hapi/driver-manifest.yaml
# The repo file is the recipe; ~/.config is a generated runtime copy (not the editor of truth).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-manifest-path.sh
source "$SCRIPT_DIR/lib/hapi-manifest-path.sh"

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
SRC="$PRIMARY/config/driver-manifest.yaml"
DEST="${HOME}/.config/hapi/driver-manifest.yaml"

if [[ ! -f "$SRC" ]]; then
    echo "ERROR: repo manifest missing: $SRC" >&2
    exit 1
fi

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
    cp -a "$DEST" "${DEST}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
fi
cp "$SRC" "$DEST"
echo "Mirrored recipe → $DEST"
echo "  source: $SRC"
echo "  layers: $(grep -c '^  - branch:' "$DEST" || echo 0) active"
