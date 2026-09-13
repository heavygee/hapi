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

# The merge gate must exist on hosts with no hapi checkout — the wrapper falls
# back to this copy. Without it, gh pr merge fails closed everywhere.
GATE_SRC="$REPO_ROOT/scripts/tooling/hapi-pr-merge-gate.sh"
if [[ -f "$GATE_SRC" ]]; then
    cp "$GATE_SRC" "$HOME/.local/bin/hapi-pr-merge-gate.sh"
    chmod +x "$HOME/.local/bin/hapi-pr-merge-gate.sh"
    echo "Installed merge gate → $HOME/.local/bin/hapi-pr-merge-gate.sh"
fi
LANEB_SRC="$REPO_ROOT/scripts/tooling/hapi-laneb-authorise.sh"
if [[ -f "$LANEB_SRC" ]]; then
    cp "$LANEB_SRC" "$HOME/.local/bin/hapi-laneb-authorise"
    chmod +x "$HOME/.local/bin/hapi-laneb-authorise"
    echo "Installed lane B authoriser → $HOME/.local/bin/hapi-laneb-authorise"
fi
chmod +x "$DEST"

echo "Installed gh wrapper → $DEST"
echo "  - Pre-PR checklist on gh pr create"
echo "  - Blocks fork-only diffs / infra branches targeting tiann/hapi"
echo "  - Fork PRs: hapi-pr-create-fork --title ... --body-file ..."
echo "  - Upstream PRs: hapi-pr-create --title ... --body-file ..."
echo ""
echo "Verify: which gh  →  should be $DEST"
