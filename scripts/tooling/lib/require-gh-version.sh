#!/usr/bin/env bash
# require-gh-version — refuse Meta / PR-hygiene tooling on stale GitHub CLI.
#
# Debian bookworm's community `gh` (2.23) lacks `gh pr checks --json`, which
# made hapi-pr-status treat "no check data" as PASS. Estate floor is the
# official GitHub CLI apt package (cli.github.com), not Debian community.
#
# Usage (source):
#   source "$SCRIPT_DIR/lib/require-gh-version.sh"
#   require_gh_version            # uses $GH_BIN or gh
#   require_gh_version /usr/bin/gh
#
# Env:
#   HAPI_GH_MIN_VERSION  default 2.80.0 (pr checks --json name,bucket)
#   HAPI_SKIP_GH_VERSION_CHECK=1  emergency bypass (prints warning)
set -euo pipefail

HAPI_GH_MIN_VERSION="${HAPI_GH_MIN_VERSION:-2.80.0}"

# _gh_version_ge <have> <need> → 0 if have >= need
_gh_version_ge() {
    local have="$1" need="$2"
    printf '%s\n%s\n' "$need" "$have" | sort -V | head -1 | grep -qx "$need"
}

# require_gh_version [gh-bin]
require_gh_version() {
    local bin="${1:-${GH_BIN:-gh}}"
    if [[ "${HAPI_SKIP_GH_VERSION_CHECK:-0}" == "1" ]]; then
        echo "require-gh-version: WARNING skipped (HAPI_SKIP_GH_VERSION_CHECK=1)" >&2
        return 0
    fi
    if ! command -v "$bin" >/dev/null 2>&1 && [[ ! -x "$bin" ]]; then
        echo "require-gh-version: ERROR gh not found ($bin)" >&2
        echo "  Install official package: scripts/tooling/install-gh-official.sh" >&2
        return 2
    fi
    local ver_line ver
    ver_line="$("$bin" --version 2>/dev/null | head -1 || true)"
    # "gh version 2.96.0 (2026-07-02)" or wrapper → real binary same format
    ver="$(printf '%s' "$ver_line" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    if [[ -z "$ver" ]]; then
        echo "require-gh-version: ERROR could not parse version from: $ver_line" >&2
        return 2
    fi
    if ! _gh_version_ge "$ver" "$HAPI_GH_MIN_VERSION"; then
        echo "require-gh-version: ERROR gh $ver < required $HAPI_GH_MIN_VERSION" >&2
        echo "  Debian community packages are too old (bookworm ships 2.23)." >&2
        echo "  Install/upgrade from official apt:" >&2
        echo "    bash scripts/tooling/install-gh-official.sh" >&2
        echo "  Or: sudo apt update && sudo apt install gh  (after github-cli.list)" >&2
        return 2
    fi
    return 0
}
