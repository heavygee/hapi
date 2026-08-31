#!/usr/bin/env bash
# Canonical gh wrapper — install to ~/.local/bin/gh via install-gh-wrapper.sh
#
# HAPI-only friction on `gh pr create` (nuzzle / other repos: passthrough):
#   1. Pre-PR checklist (verification + cold review reminder)
#   2. Block fork-only PRs against tiann/hapi (2026-06-24 #971 class)
#   3. Human confirm: Enter on a real controlling TTY
#   4. Agent confirm: HAPI_PR_CREATE_ACK=1 (never block on read — agents hang forever)
#
# Must precede /usr/bin/gh on PATH. Also intercepts gh-ll/gh-gavinc/gh-heavygee
# because they exec gh internally.
#
# Detection: a checkout is "hapi" when its git root has
# scripts/tooling/lib/pr-target-guard.sh (fork mirror, driver, worktrees).

set -euo pipefail

REAL_GH="${HAPI_REAL_GH:-/usr/bin/gh}"

# Inline copy of lib/operator-tty-gate.sh::caller_has_controlling_tty —
# ~/.local/bin/gh is a copied install and must not depend on a live hapi tree.
caller_has_controlling_tty() {
    local stat_line tty_nr
    [ -r "/proc/$PPID/stat" ] || return 1
    # shellcheck disable=SC2002
    stat_line="$(cat "/proc/$PPID/stat" 2>/dev/null)" || return 1
    tty_nr=$(printf '%s' "$stat_line" | sed 's/.*) //' | awk '{print $5}')
    [ -n "$tty_nr" ] && [ "$tty_nr" != "0" ]
}

is_agent_context() {
    [[ "${HAPI_AGENT_CONTEXT:-}" == "1" ]] && return 0
    [[ "${CURSOR_AGENT:-}" == "1" ]] && return 0
    [[ "${CURSOR_INVOKED_AS:-}" == "agent" ]] && return 0
    [[ -n "${CURSOR_AGENT_SESSION_ID:-}" ]] && return 0
    [[ -n "${CLAUDECODE:-}" ]] && return 0
    [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]] && return 0
    if ! caller_has_controlling_tty; then
        return 0
    fi
    return 1
}

hapi_tree_root() {
    local root
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
    [[ -f "$root/scripts/tooling/lib/pr-target-guard.sh" ]] || return 1
    printf '%s\n' "$root"
}

if [[ "${1:-}" == "pr" && "${2:-}" == "create" ]]; then
    root=""
    if root="$(hapi_tree_root)"; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  PRE-PR MANDATORY CHECKLIST (hapi)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  Before filing this PR, confirm BOTH are done:" >&2
        echo "  1. /verification-before-completion — checks pass with evidence" >&2
        echo "  2. /requesting-code-review — cold diff read, findings addressed" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

        PR_TARGET_GUARD_ROOT="$root"
        # shellcheck source=/dev/null
        source "$root/scripts/tooling/lib/pr-target-guard.sh"
        repo="$(pr_target_resolve_repo "$@")"
        if block_msg="$(pr_target_upstream_block_reason "$repo" "$@")"; then
            echo "" >&2
            echo "$block_msg" >&2
            exit 2
        fi

        if is_agent_context; then
            if [[ "${HAPI_PR_CREATE_ACK:-}" != "1" ]]; then
                cat >&2 <<'MSG'

REFUSE: gh pr create from agent / non-operator shell without HAPI_PR_CREATE_ACK=1.

Gates stay on — this is not a bypass. After verification + cold review:
  export HAPI_PR_CREATE_ACK=1
  gh pr create ...

Or use the supported helpers (they set the ack for you):
  hapi-pr-create --title ... --body-file ...
  hapi-pr-create-fork --title ... --body-file ...

Non-hapi repos (e.g. nuzzle) never hit this checklist — reinstall wrapper if they do.
MSG
                exit 2
            fi
            echo "  HAPI_PR_CREATE_ACK=1 — agent ack accepted; proceeding." >&2
        elif [ -t 0 ] && [ -t 2 ] && caller_has_controlling_tty; then
            echo "  Press Enter to confirm, or Ctrl+C to cancel." >&2
            if ! read -r -t "${HAPI_PR_CREATE_READ_TIMEOUT:-120}"; then
                echo "" >&2
                echo "REFUSE: timed out waiting for Enter confirm (${HAPI_PR_CREATE_READ_TIMEOUT:-120}s)." >&2
                echo "Agents: export HAPI_PR_CREATE_ACK=1 after verification instead." >&2
                exit 2
            fi
        else
            echo "  (no operator TTY — skipping Enter; need HAPI_PR_CREATE_ACK=1)" >&2
            if [[ "${HAPI_PR_CREATE_ACK:-}" != "1" ]]; then
                echo "REFUSE: non-TTY gh pr create in a hapi tree needs HAPI_PR_CREATE_ACK=1." >&2
                exit 2
            fi
        fi
    fi
fi

exec "$REAL_GH" "$@"
