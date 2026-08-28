#!/usr/bin/env bash
# hapi-cli-path-hygiene — kill stale npm/bun global `hapi` that shadows soup CLI.
#
# Estate footgun (2026-08-09 / Peer #7): ~/.bun/bin/hapi → @twsxtd/hapi@0.20.x
# has no `job` / `ping-peer`; agents that hit it think "hapi job" is Claude
# passthrough. Soup hosts want ONLY ~/.local/bin/hapi → hapi-from-active.
#
# Broader trap (2026-08-28 / Arthur scout): sessions whose cwd is inside a tree
# that depends on hapi prepend `node_modules/.bin` ahead of ~/.local/bin.
# `command -v hapi` then resolves to the **published** prebuilt (may lack
# `spawn-peer`). Profile PATH hygiene cannot beat cwd-injected bins — invoke
# `~/.local/bin/hapi`, `hapi-from-active`, or `hapi-spawn-peer` by absolute name.
#
# Usage:
#   hapi-cli-path-hygiene           # check + clean (default)
#   hapi-cli-path-hygiene --check   # report only; exit 1 if dirty
#   hapi-cli-path-hygiene --clean   # remove stale globals + reinstall soup shim
#
# Safe on fleet runners that have no soup tree: skips from-active install if
# scripts/tooling/hapi-from-active.sh is missing; still removes bun/npm globals.
set -euo pipefail

MODE=clean
case "${1:-}" in
    --check) MODE=check ;;
    --clean|'') MODE=clean ;;
    -h|--help)
        sed -n '2,20p' "$0" | sed 's/^# \?//'
        exit 0
        ;;
    *)
        echo "usage: hapi-cli-path-hygiene [--check|--clean]" >&2
        exit 2
        ;;
esac

DIRTY=0
WARN=0
BUN_HAPI="${HOME}/.bun/bin/hapi"
BUN_PKG="${HOME}/.bun/install/global/node_modules/@twsxtd/hapi"
NPM_ROOT="$(npm root -g 2>/dev/null || true)"
NPM_PKG=""
NPM_BIN=""
if [[ -n "$NPM_ROOT" ]]; then
    NPM_PKG="${NPM_ROOT}/@twsxtd/hapi"
    NPM_BIN="$(dirname "$NPM_ROOT")/bin/hapi"
fi

report() { echo "hapi-cli-path-hygiene: $*" >&2; }

if [[ -e "$BUN_HAPI" || -d "$BUN_PKG" ]]; then
    DIRTY=1
    ver="?"
    [[ -f "$BUN_PKG/package.json" ]] && ver="$(jq -r .version "$BUN_PKG/package.json" 2>/dev/null || echo '?')"
    report "stale bun-global hapi present (ver=$ver) at $BUN_HAPI"
fi
if [[ -n "$NPM_PKG" && -d "$NPM_PKG" ]]; then
    DIRTY=1
    report "stale npm-global @twsxtd/hapi at $NPM_PKG"
fi

# On soup hosts, first `hapi` on PATH must be from-active.
FIRST="$(command -v hapi 2>/dev/null || true)"
if [[ -n "$FIRST" && "$FIRST" == */.bun/bin/hapi ]]; then
    DIRTY=1
    report "PATH resolves hapi to bun-global first: $FIRST"
fi
if [[ -n "$FIRST" && "$FIRST" == */.npm-global/bin/hapi ]]; then
    DIRTY=1
    report "PATH resolves hapi to npm-global first: $FIRST"
fi
if [[ -n "$FIRST" && "$FIRST" == */node_modules/.bin/hapi ]]; then
    # Cannot safely delete cwd node_modules bins; flag for agents.
    WARN=1
    report "WARN — PATH resolves hapi to node_modules/.bin (published shim): $FIRST"
    report "WARN — use ~/.local/bin/hapi, hapi-from-active, or hapi-spawn-peer (absolute)"
fi

if [[ "$MODE" == check ]]; then
    if [[ "$DIRTY" -eq 0 && "$WARN" -eq 0 ]]; then
        report "OK — no stale bun/npm global hapi; first=$(command -v hapi 2>/dev/null || echo none)"
        exit 0
    fi
    if [[ "$DIRTY" -eq 0 && "$WARN" -ne 0 ]]; then
        report "WARN-only — globals clean; node_modules/.bin shadows soup (use absolute path)"
        exit 0
    fi
    report "DIRTY — re-run without --check (or --clean) to remove"
    exit 1
fi

# --clean
if [[ -d "$BUN_PKG" ]] && command -v bun >/dev/null 2>&1; then
    bun remove -g @twsxtd/hapi >/dev/null 2>&1 || true
fi
rm -f "$BUN_HAPI"
if [[ -n "$NPM_PKG" && -d "$NPM_PKG" ]] && command -v npm >/dev/null 2>&1; then
    npm uninstall -g @twsxtd/hapi >/dev/null 2>&1 || true
fi
[[ -n "$NPM_BIN" ]] && rm -f "$NPM_BIN"

# Drop junk integration-test binary if present (oos incident residue).
rm -f "${HOME}/.hapi/bin/hapi-0.0.0-integration-test-should-be-auto-cleaned-up-"* 2>/dev/null || true

TOOLING="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
if [[ -x "$TOOLING/install-hapi-local-bin.sh" ]]; then
    bash "$TOOLING/install-hapi-local-bin.sh"
elif [[ -x "$HOME/coding/hapi/scripts/tooling/install-hapi-local-bin.sh" ]]; then
    bash "$HOME/coding/hapi/scripts/tooling/install-hapi-local-bin.sh"
fi

hash -r 2>/dev/null || true
FIRST="$(command -v hapi 2>/dev/null || true)"
if [[ -e "$BUN_HAPI" || -d "$BUN_PKG" ]]; then
    report "FAILED — bun-global hapi still present after clean"
    exit 1
fi
if [[ -n "$FIRST" && "$FIRST" == */.bun/bin/hapi ]]; then
    report "FAILED — PATH still prefers bun-global: $FIRST"
    exit 1
fi
report "OK — first hapi=${FIRST:-none}"
if [[ -n "$FIRST" ]] && "$FIRST" job --help >/dev/null 2>&1; then
    report "OK — \`hapi job\` is available"
elif [[ -n "$FIRST" ]]; then
    report "NOTE — \`hapi job\` not on this binary yet (pre-#1424 soup tip or stock runner); PATH hygiene still OK"
fi
exit 0
