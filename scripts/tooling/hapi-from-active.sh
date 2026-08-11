#!/usr/bin/env bash
# Operator PATH entry for `hapi`: run the CLI from whatever tree hapi-active
# points at (soup / driver), not the stale bun-global npm package.
#
# Why this exists (2026-07-28): agents saw `~/.bun/bin/hapi` @ 0.20.2 (no
# `ping-peer`), then invented `cd driver/cli && bun run src/index.ts ping-peer`
# instead of using `hapi-ping-peer` or a soup-aware `hapi`. Installing this as
# `~/.local/bin/hapi` (ahead of `~/.bun/bin` on PATH) makes `hapi ping-peer`
# and the rest of the soup CLI work from any cwd.
#
# Sibling: hapi-runner-from-active.sh (systemd runner only).
# See docs/tooling/driver-soup.md § Scripts / hapi-from-active.
set -euo pipefail

BUN="${BUN:-$HOME/.bun/bin/bun}"
ACTIVE_LINK="${HAPI_ACTIVE_LINK:-$HOME/coding/hapi/active}"

if [[ ! -L "$ACTIVE_LINK" && ! -d "$ACTIVE_LINK" ]]; then
    echo "hapi-from-active: ERROR: hapi-active missing at $ACTIVE_LINK" >&2
    echo "  (soup host: ln -sfn ~/coding/hapi/driver ~/coding/hapi/active)" >&2
    exit 1
fi

ACTIVE="$(readlink -f "$ACTIVE_LINK")"
CLI_DIR="$ACTIVE/cli"

if [[ ! -f "$CLI_DIR/src/index.ts" ]]; then
    echo "hapi-from-active: ERROR: active tree missing cli: $CLI_DIR" >&2
    exit 1
fi

if [[ ! -d "$ACTIVE/node_modules" ]]; then
    echo "hapi-from-active: ERROR: active tree missing node_modules — run: cd $ACTIVE && bun install" >&2
    exit 1
fi

if [[ ! -x "$BUN" ]]; then
    echo "hapi-from-active: ERROR: bun not found at $BUN" >&2
    exit 1
fi

# Keep agent/operator CLI on soup; do not hand off to Upgrade binaries.
export HAPI_DISABLE_VERSION_HANDOFF="${HAPI_DISABLE_VERSION_HANDOFF:-1}"
export HAPI_API_URL="${HAPI_API_URL:-http://127.0.0.1:3006}"

# Fork-only: `hapi hold-ack` is Meta state, not soup CLI.
if [[ "${1:-}" == "hold-ack" ]]; then
    shift
    exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/hapi-hold-ack.sh" "$@"
fi

cd "$CLI_DIR"
exec "$BUN" run src/index.ts "$@"
