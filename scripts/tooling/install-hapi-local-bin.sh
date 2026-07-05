#!/usr/bin/env bash
# Install ~/.local/bin symlinks for operator HAPI tooling + PR review helpers.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLING="${REPO_ROOT}/scripts/tooling"
BIN="${HAPI_LOCAL_BIN:-$HOME/.local/bin}"

mkdir -p "$BIN"

for s in "$TOOLING"/hapi-*.sh "$TOOLING"/hapi-worktree-create.sh "$TOOLING"/hapi-worktree-create; do
  [[ -f "$s" ]] || continue
  base="$(basename "$s" .sh)"
  ln -sf "$s" "$BIN/$base"
done

# Optional cross-repo helper when server-setup is present.
if [[ -f "$HOME/coding/server-setup/scripts/hapi/hapi-sessions-health.sh" ]]; then
  ln -sf "$HOME/coding/server-setup/scripts/hapi/hapi-sessions-health.sh" "$BIN/hapi-sessions-health.sh"
fi

install -m 755 "$TOOLING/lib/pr-open-push-lib.sh" "$BIN/pr-open-push-lib.sh"
install -m 755 "$TOOLING/pr-post-push-check-core.sh" "$BIN/pr-post-push-check-core.sh"
install -m 755 "$TOOLING/hooks/claude/pr-post-push-check.sh" "$BIN/pr-post-push-check"

echo "install-hapi-local-bin: OK → $BIN"
