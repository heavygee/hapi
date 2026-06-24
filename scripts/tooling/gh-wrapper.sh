#!/usr/bin/env bash
# Canonical gh wrapper — install to ~/.local/bin/gh via install-gh-wrapper.sh
#
# 1. Pre-PR checklist on `gh pr create`
# 2. Block fork-only PRs against tiann/hapi (2026-06-24 #971 class)
#
# Must precede /usr/bin/gh on PATH. Also intercepts gh-ll/gh-gavinc/gh-heavygee
# because they exec gh internally.

set -euo pipefail

REAL_GH="${HAPI_REAL_GH:-/usr/bin/gh}"

if [[ "${1:-}" == "pr" && "${2:-}" == "create" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  PRE-PR MANDATORY CHECKLIST" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  Before filing this PR, confirm BOTH are done:" >&2
    echo "  1. /verification-before-completion — checks pass with evidence" >&2
    echo "  2. /requesting-code-review — cold diff read, findings addressed" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    # Target guard when inside hapi fork clone
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
        root="$(git rev-parse --show-toplevel)"
        if [[ -f "$root/scripts/tooling/lib/pr-target-guard.sh" ]]; then
            PR_TARGET_GUARD_ROOT="$root"
            # shellcheck source=/dev/null
            source "$root/scripts/tooling/lib/pr-target-guard.sh"
            repo="$(pr_target_resolve_repo "$@")"
            if block_msg="$(pr_target_upstream_block_reason "$repo" "$@")"; then
                echo "" >&2
                echo "$block_msg" >&2
                exit 2
            fi
        fi
    fi

    if [ -t 0 ] && [ -t 2 ]; then
        echo "  Press Enter to confirm, or Ctrl+C to cancel." >&2
        read -r
    fi
fi

exec "$REAL_GH" "$@"
