#!/usr/bin/env bash
# Installer for operator-local Cursor hooks in this repo.
#
# This repo's .gitignore intentionally keeps .cursor/hooks.json and .cursor/hooks/
# untracked (per-user state). The canonical hook scripts live in scripts/tooling/
# (tracked); this installer writes a per-user .cursor/hooks.json that points at
# them. Run on every fresh clone (or any machine that needs the hooks).
#
# Idempotent: rewrites .cursor/hooks.json each time. Preserves nothing in that
# file - if you have machine-specific Cursor hooks, keep them in
# ~/.cursor/hooks.json (user-level) instead.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_JSON="${REPO_ROOT}/.cursor/hooks.json"
PRODUCT_GUARD="${REPO_ROOT}/scripts/tooling/hapi-product-code-guard.sh"
SYSTEMCTL_GUARD="${REPO_ROOT}/scripts/tooling/hapi-systemctl-guard.sh"
MUTATION_GUARD="${REPO_ROOT}/scripts/tooling/hapi-production-mutation-guard.sh"
MIRROR_HYGIENE_GUARD="${REPO_ROOT}/scripts/tooling/hapi-mirror-hygiene-guard.sh"
TOOLING_COMMIT_GUARD="${REPO_ROOT}/scripts/tooling/hapi-tooling-commit-guard.sh"
REMAT_HOLD_GUARD="${REPO_ROOT}/scripts/tooling/hapi-remat-hold-guard.sh"
SOUP_DOGFOOD_RULE="${REPO_ROOT}/scripts/tooling/cursor-rules/hapi-driver-soup-dogfood.mdc"
TOOLING_COMMIT_RULE="${REPO_ROOT}/.cursor/rules/hapi-tooling-commit-hygiene.mdc"
USER_RULES="${HOME}/.cursor/rules"

for s in "$PRODUCT_GUARD" "$SYSTEMCTL_GUARD" "$MUTATION_GUARD" "$MIRROR_HYGIENE_GUARD" "$TOOLING_COMMIT_GUARD" "$REMAT_HOLD_GUARD"; do
    if [ ! -x "$s" ]; then
        echo "ERROR: ${s} missing or not executable" >&2
        exit 1
    fi
done

if [ ! -f "$SOUP_DOGFOOD_RULE" ]; then
    echo "ERROR: ${SOUP_DOGFOOD_RULE} missing" >&2
    exit 1
fi

mkdir -p "${REPO_ROOT}/.cursor"
mkdir -p "$USER_RULES"
ln -sf "$SOUP_DOGFOOD_RULE" "${USER_RULES}/hapi-driver-soup-dogfood.mdc"
if [ -f "$TOOLING_COMMIT_RULE" ]; then
    ln -sf "$TOOLING_COMMIT_RULE" "${USER_RULES}/hapi-tooling-commit-hygiene.mdc"
fi

cat > "$HOOKS_JSON" <<'JSON'
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "./scripts/tooling/hapi-product-code-guard.sh",
        "matcher": "Write|Edit|StrReplace|MultiEdit|EditNotebook"
      },
      {
        "command": "./scripts/tooling/hapi-mirror-hygiene-guard.sh",
        "matcher": "Write|Edit|StrReplace|MultiEdit|EditNotebook|Shell"
      },
      {
        "command": "./scripts/tooling/hapi-systemctl-guard.sh",
        "matcher": "Shell"
      },
      {
        "command": "./scripts/tooling/hapi-remat-hold-guard.sh",
        "matcher": "Shell"
      },
      {
        "command": "./scripts/tooling/hapi-production-mutation-guard.sh",
        "matcher": "Shell"
      },
      {
        "command": "./scripts/tooling/hapi-tooling-commit-guard.sh shell",
        "matcher": "Shell"
      }
    ],
    "postToolUse": [
      {
        "command": "./scripts/tooling/hapi-tooling-commit-guard.sh record",
        "matcher": "Write|Edit|StrReplace|MultiEdit|EditNotebook|Shell"
      }
    ],
    "afterFileEdit": [
      {
        "command": "./scripts/tooling/hapi-tooling-commit-guard.sh record"
      }
    ],
    "stop": [
      {
        "command": "./scripts/tooling/hapi-tooling-commit-guard.sh stop",
        "loop_limit": 5
      }
    ]
  }
}
JSON

echo "Wrote ${HOOKS_JSON}"
echo "Hooks installed:"
echo "  hapi-product-code-guard.sh       -> blocks edits to cli/, hub/, web/, shared/ outside ~/coding/hapi/worktrees/"
echo "  hapi-mirror-hygiene-guard.sh     -> blocks bun install / lockfile+e2e writes on primary mirror (soup utensils)"
echo "  hapi-systemctl-guard.sh          -> blocks 'sudo systemctl <destructive-verb> hapi-{hub,runner,runner-watchdog}.service'"
echo "  hapi-remat-hold-guard.sh         -> blocks remat/build-web while remat escalation hold is active"
echo "  hapi-production-mutation-guard.sh -> blocks feat-dist swap, driver hand-merge, raw driver/web builds, full rebuild"
echo "  hapi-tooling-commit-guard.sh     -> mess-maker must commit docs/scripts/manifest/.cursor dirt (stop + sync gate)"
echo "  hapi-driver-soup-dogfood.mdc       -> symlink → ${USER_RULES}/hapi-driver-soup-dogfood.mdc"
echo "  hapi-tooling-commit-hygiene.mdc    -> symlink → ${USER_RULES}/hapi-tooling-commit-hygiene.mdc (if present)"
echo
echo "Bypasses when needed (operator-approved):"
echo "  HAPI_OPERATOR_PRODUCT_EDIT_OVERRIDE=1   (product-code edits)"
echo "  HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1 (mirror install/e2e — TTY only)"
echo "  HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1      (systemctl on hapi units)"
echo "  HAPI_OPERATOR_PRODUCTION_MUTATION_OVERRIDE=1 (dist swap / driver hand-merge — TTY only)"
echo "  HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE=1  (mess-maker commit nag — TTY only)"
echo "  HAPI_OPERATOR_REMAT_HOLD_CLEAR=1       (clear/bypass remat hold — TTY only)"
echo "  HAPI_REMAT_OWNER=1                    (Meta remat owner while hold active)"
echo
echo "Restart Cursor (or reload) to pick up the hooks."
