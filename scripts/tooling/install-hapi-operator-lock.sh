#!/usr/bin/env bash
# Install full operator HAPI lock tooling on this host (homelab, oos-linux, fresh server).
#
# Idempotent. All artifacts live in this fork under scripts/tooling/ — nothing
# hand-installed only on one machine.
#
# Usage:
#   ./scripts/tooling/install-hapi-operator-lock.sh              # user-layer only
#   ./scripts/tooling/install-hapi-operator-lock.sh --with-sudo  # + systemctl/tailscale/sudoers wrappers
#   ./scripts/tooling/verify-hapi-operator-lock.sh [--with-sudo]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

WITH_SUDO=0
SKIP_CURSOR_USER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-sudo) WITH_SUDO=1; shift ;;
    --skip-cursor-user) SKIP_CURSOR_USER=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "install-hapi-operator-lock: unknown arg $1" >&2; exit 2 ;;
  esac
done

chmod +x scripts/tooling/*.sh scripts/tooling/lib/*.sh scripts/tooling/hooks/cursor/*.sh \
  scripts/tooling/hooks/claude/*.sh 2>/dev/null || true

echo "=== install-hapi-operator-lock: PATH + local bin ==="
./scripts/tooling/install-hapi-local-bin.sh
grep -q 'HAPI operator lock PATH' "$HOME/.profile" 2>/dev/null || {
  cat >>"$HOME/.profile" <<'PROFILE'

# HAPI operator lock PATH
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
PROFILE
}
grep -q 'HAPI operator lock PATH' "$HOME/.bashrc" 2>/dev/null || {
  cat >>"$HOME/.bashrc" <<'BASHRC'

# HAPI operator lock PATH
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
BASHRC
}

echo "=== install-hapi-operator-lock: git + gh wrappers ==="
./scripts/tooling/install-git-wrapper.sh
./scripts/tooling/install-gh-wrapper.sh
./scripts/tooling/install-git-hooks.sh

echo "=== install-hapi-operator-lock: Cursor repo hooks (preToolUse guards) ==="
./scripts/tooling/hapi-install-cursor-hooks.sh

if [[ "$SKIP_CURSOR_USER" -eq 0 ]]; then
  echo "=== install-hapi-operator-lock: Cursor user hooks (PR gates) ==="
  ./scripts/tooling/install-hapi-cursor-user-hooks.sh
fi

if [[ "$WITH_SUDO" -eq 1 ]]; then
  echo "=== install-hapi-operator-lock: sudo secure_path wrappers ==="
  sudo bash scripts/tooling/install-hapi-sudoers.sh
  sudo bash scripts/tooling/install-systemctl-wrapper.sh
  sudo bash scripts/tooling/install-tailscale-wrapper.sh
fi

echo "install-hapi-operator-lock: OK (repo=${REPO_ROOT})"
echo "Verify: ./scripts/tooling/verify-hapi-operator-lock.sh$([[ $WITH_SUDO -eq 1 ]] && echo ' --with-sudo')"
