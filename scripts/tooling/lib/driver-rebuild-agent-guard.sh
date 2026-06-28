#!/usr/bin/env bash
# Refuse manifest-only hapi-driver-rebuild from agent / non-interactive shells.
#
# Cursor preToolUse hook covers the same patterns for Cursor only. Claude/Codex/
# Gemini shells reach ~/.local/bin/hapi-driver-rebuild directly — this is the
# agent-agnostic backstop (same class as systemctl-wrapper on secure_path).
#
# Source after BUILD_WEB is parsed. Expects LIB_DIR set.
set -euo pipefail

# shellcheck source=operator-tty-gate.sh
source "${LIB_DIR}/operator-tty-gate.sh"

driver_rebuild_agent_guard() {
    local build_web="${1:-0}"

    [[ "$build_web" -eq 1 ]] && return 0

    if [[ "${HAPI_OPERATOR_DRIVER_REBUILD_MERGE_ONLY:-}" == "1" ]]; then
        return 0
    fi

    local is_agent=0
    if [[ "${HAPI_AGENT_CONTEXT:-}" == "1" ]]; then
        is_agent=1
    elif ! caller_has_controlling_tty; then
        is_agent=1
    fi

    [[ "$is_agent" -eq 0 ]] && return 0

    if [[ "${HAPI_OPERATOR_DRIVER_REBUILD_OVERRIDE:-}" == "1" ]] && caller_has_controlling_tty; then
        return 0
    fi

    cat >&2 <<'EOF'
REFUSE: manifest-only hapi-driver-rebuild from agent / non-tty shell.

This rewrote driver/integration web/src without rebuilding web/dist — :3006
will serve a stale bundle (53+ missing features: machine health, scratchlist,
overseer inbox, copy-reference, model-error banner, …).

Use instead:
  hapi-driver-rebuild --build-web --verify
  hapi-driver-build-web   (when driver HEAD already matches manifest)

Never: git merge/cherry-pick inside ~/coding/hapi/driver (#962 hand-merge).

Operator merge-only (cron/meta): HAPI_OPERATOR_DRIVER_REBUILD_MERGE_ONLY=1
Emergency TTY bypass: HAPI_OPERATOR_DRIVER_REBUILD_OVERRIDE=1

See docs/tooling/driver-soup.md
EOF
    return 1
}
