#!/usr/bin/env bash
# Install canonical gh wrapper (pre-PR checklist + fork upstream block) to ~/.local/bin/gh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/scripts/tooling/gh-wrapper.sh"
DEST="${HAPI_GH_WRAPPER_DEST:-$HOME/.local/bin/gh}"
REAL_GH="${HAPI_REAL_GH:-/usr/bin/gh}"

if [[ ! -f "$SRC" ]]; then
    echo "ERROR: missing $SRC" >&2
    exit 1
fi
if [[ ! -x "$REAL_GH" ]]; then
    echo "ERROR: real gh not found at $REAL_GH (set HAPI_REAL_GH)" >&2
    exit 1
fi

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" && ! -L "$DEST" ]] && ! grep -q 'gh-wrapper.sh\|PRE-PR MANDATORY CHECKLIST' "$DEST" 2>/dev/null; then
    cp -a "$DEST" "${DEST}.prev"
    echo "Backed up previous wrapper → ${DEST}.prev"
fi

cp "$SRC" "$DEST"
chmod +x "$DEST"

echo "Installed gh wrapper → $DEST"
echo "  - Pre-PR checklist on gh pr create"
echo "  - Blocks fork-only diffs / infra branches targeting tiann/hapi"
echo "  - Fork PRs: hapi-pr-create-fork --title ... --body-file ..."
echo "  - Upstream PRs: hapi-pr-create --title ... --body-file ..."
echo ""
echo "Verify: which gh  →  should be $DEST"
