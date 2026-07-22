#!/usr/bin/env bash
# systemd ExecStart helper: run hapi runner from whatever tree hapi-active points at.
#
# This is a SOUP / rebuild-only entrypoint. Hub "Upgrade" artifacts under
# ~/.hapi/bin/hapi* are intentionally ignored — systemd will keep bringing
# this script back. Version moves on soup hosts via hapi-driver-rebuild
# (rematerialize onto new upstream), not fleet Upgrade. See
# docs/tooling/driver-soup.md § Soup hosts vs fleet Upgrade.
set -euo pipefail

BUN="${BUN:-$HOME/.bun/bin/bun}"
ACTIVE_LINK="${HAPI_ACTIVE_LINK:-$HOME/coding/hapi/active}"
ACTIVE="$(readlink -f "$ACTIVE_LINK")"
CLI_DIR="$ACTIVE/cli"
CODING_ROOT="${HAPI_CODING_ROOT:-$HOME/coding}"

if [[ ! -f "$CLI_DIR/src/index.ts" ]]; then
    echo "ERROR: active tree missing cli: $CLI_DIR" >&2
    exit 1
fi

if [[ ! -d "$ACTIVE/node_modules" ]]; then
    echo "ERROR: active tree missing node_modules — run: cd $ACTIVE && bun install" >&2
    exit 1
fi

# Prefer handoff disable when supervised — Upgrade binary must not fight us.
export HAPI_DISABLE_VERSION_HANDOFF="${HAPI_DISABLE_VERSION_HANDOFF:-1}"

export HAPI_API_URL="${HAPI_API_URL:-http://127.0.0.1:3006}"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"

pkg_ver="unknown"
if [[ -f "$CLI_DIR/package.json" ]]; then
    pkg_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CLI_DIR/package.json" | head -1)"
fi
echo "hapi-runner-from-active: soup entrypoint active=$ACTIVE cli=$pkg_ver (Upgrade binary ignored; HAPI_DISABLE_VERSION_HANDOFF=$HAPI_DISABLE_VERSION_HANDOFF)"

cd "$CLI_DIR"
exec "$BUN" run src/index.ts runner start-sync \
    --workspace-root "$CODING_ROOT" \
    --workspace-root "$ACTIVE"
