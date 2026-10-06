#!/usr/bin/env bash
# Verify operator HAPI lock tooling installed from this fork.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WITH_SUDO=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-sudo) WITH_SUDO=1; shift ;;
    -h|--help) exit 0 ;;
    *) echo "verify-hapi-operator-lock: unknown arg $1" >&2; exit 2 ;;
  esac
done

fail() { echo "verify-hapi-operator-lock: FAIL — $*" >&2; exit 1; }

command -v hapi-driver-rebuild >/dev/null || fail "hapi-driver-rebuild not on PATH (run install-hapi-local-bin.sh)"
command -v hapi-ping-peer >/dev/null || fail "hapi-ping-peer not on PATH (run install-hapi-local-bin.sh)"
# Soup-aware hapi must beat stale bun-global (missing ping-peer).
[[ "$(command -v hapi)" == "$HOME/.local/bin/hapi" ]] \
  || fail "hapi is not ~/.local/bin/hapi (got: $(command -v hapi)) — run install-hapi-local-bin.sh"
hapi ping-peer --help >/dev/null 2>&1 \
  || fail "hapi ping-peer --help failed (soup CLI / hapi-from-active broken)"
test -x "$HOME/.local/bin/git" || fail "git wrapper missing"
test -x "$HOME/.local/bin/gh" || fail "gh wrapper missing"
test -f "$HOME/.local/bin/pr-open-push-lib.sh" || fail "pr-open-push-lib.sh missing"
test -f "$HOME/.local/bin/pr-post-push-check-core.sh" || fail "pr-post-push-check-core.sh missing"
test -f "$REPO_ROOT/.cursor/hooks.json" || fail "repo .cursor/hooks.json missing"
test -L "$HOME/.cursor/rules/hapi-driver-soup-dogfood.mdc" \
  || test -f "$HOME/.cursor/rules/hapi-driver-soup-dogfood.mdc" \
  || fail "soup dogfood cursor rule missing"
[[ "$(git -C "$REPO_ROOT" config core.hooksPath)" == *scripts/tooling/git-hooks* ]] \
  || fail "git hooksPath not set"

if [[ -f "$HOME/.cursor/hooks.json" ]]; then
  grep -q 'pr-before-shell-gates.sh' "$HOME/.cursor/hooks.json" \
    || fail "user Cursor hooks missing pr-before-shell-gates"
  grep -q 'pr-post-push-check.sh' "$HOME/.cursor/hooks.json" \
    || fail "user Cursor hooks missing pr-post-push-check"
fi

if [[ "$WITH_SUDO" -eq 1 ]]; then
  test -x /usr/local/sbin/systemctl || fail "systemctl wrapper missing"
  test -x /usr/local/sbin/tailscale || fail "tailscale wrapper missing"
  sudo test -f /etc/sudoers.d/hapi-protect || fail "hapi-protect sudoers missing"
  REFUSE="$(sudo /usr/local/sbin/systemctl stop hapi-hub-oos.service 2>&1 || sudo /usr/local/sbin/systemctl stop hapi-hub.service 2>&1 || true)"
  echo "$REFUSE" | grep -qE 'BLOCKED|hapi-systemctl-wrapper' \
    || fail "systemctl wrapper did not refuse destructive hapi stop"
fi

echo "verify-hapi-operator-lock: OK"
