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

# Soup-aware `hapi` must win over ~/.bun/bin/hapi (stale npm global, often
# missing ping-peer / job). ~/.local/bin is earlier on PATH on this host.
if [[ -f "$TOOLING/hapi-from-active.sh" ]]; then
  ln -sf "$TOOLING/hapi-from-active.sh" "$BIN/hapi"
  ln -sf "$TOOLING/hapi-from-active.sh" "$BIN/hapi-from-active"
fi
# Also install the hygiene entrypoint (does not auto-run — call explicitly
# or from operator bootstrap). Removes bun/npm global shadows.
if [[ -f "$TOOLING/hapi-cli-path-hygiene.sh" ]]; then
  ln -sf "$TOOLING/hapi-cli-path-hygiene.sh" "$BIN/hapi-cli-path-hygiene"
fi

# Optional cross-repo helper when server-setup is present.
if [[ -f "$HOME/coding/server-setup/scripts/hapi/hapi-sessions-health.sh" ]]; then
  ln -sf "$HOME/coding/server-setup/scripts/hapi/hapi-sessions-health.sh" "$BIN/hapi-sessions-health.sh"
fi

install -m 755 "$TOOLING/lib/pr-open-push-lib.sh" "$BIN/pr-open-push-lib.sh"
install -m 755 "$TOOLING/pr-post-push-check-core.sh" "$BIN/pr-post-push-check-core.sh"
install -m 755 "$TOOLING/hooks/claude/pr-post-push-check.sh" "$BIN/pr-post-push-check"

echo "install-hapi-local-bin: OK → $BIN"
