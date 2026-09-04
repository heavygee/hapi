#!/usr/bin/env bash
# hapi-claude-rebind-session — bind a Claude HAPI row in-place (no hub merge resume).
#
# Same idea as hapi-safe-revive-session for Cursor (#991): runClaude with
# existingSessionId + resumeSessionId so the original row keeps its id/url.
#
# Usage:
#   hapi-claude-rebind-session <hapi-session-id> <working-dir> <claude-session-id> [label]
#   hapi-claude-rebind-session --detach ...   # default
#   hapi-claude-rebind-session --foreground ...
set -euo pipefail
export PATH="/home/heavygee/.bun/bin:/home/heavygee/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

DETACH=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --detach) DETACH=1; shift ;;
        --foreground) DETACH=0; shift ;;
        -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) break ;;
    esac
done

HAPI_SESSION_ID="${1:-}"
WORKING_DIR="${2:-}"
CLAUDE_SESSION_ID="${3:-}"
LABEL="${4:-claude-rebind}"

[[ -n "$HAPI_SESSION_ID" && -n "$WORKING_DIR" && -n "$CLAUDE_SESSION_ID" ]] || {
    echo "usage: hapi-claude-rebind-session [--detach|--foreground] <hapi-id> <dir> <claude-id> [label]" >&2
    exit 2
}
[[ -d "$WORKING_DIR" ]] || { echo "working dir missing: $WORKING_DIR" >&2; exit 2; }

SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
export CLI_API_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
export HAPI_API_URL="${HAPI_API_URL:-$(jq -r '.apiUrl // empty' "$SETTINGS" 2>/dev/null)}"
[[ -n "$HAPI_API_URL" ]] || export HAPI_API_URL="http://127.0.0.1:3006"

ACTIVE="$(readlink -f "${HAPI_ACTIVE:-$HOME/coding/hapi/active}" 2>/dev/null || echo "$HOME/coding/hapi/driver")"
DRIVER_CLI="${HAPI_DRIVER_CLI:-$ACTIVE/cli}"

LOG="/tmp/rebind-${HAPI_SESSION_ID:0:8}-${LABEL}.log"
PIDFILE="/tmp/rebind-${HAPI_SESSION_ID:0:8}.pid"

export WORKING_DIR DRIVER_CLI HAPI_SESSION_ID CLAUDE_SESSION_ID

run_claude() {
    cd "$WORKING_DIR"
    exec bun --cwd "$DRIVER_CLI" -e "
import { initializeToken } from './src/ui/tokenInit.ts';
import { authAndSetupMachineIfNeeded } from './src/ui/auth.ts';
import { runClaude } from './src/claude/runClaude.ts';
await initializeToken();
await authAndSetupMachineIfNeeded();
await runClaude({
  existingSessionId: '${HAPI_SESSION_ID}',
  workingDirectory: '${WORKING_DIR}',
  resumeSessionId: '${CLAUDE_SESSION_ID}',
  startedBy: 'runner',
  startingMode: 'remote',
  permissionMode: 'bypassPermissions',
});
"
}

if [[ "$DETACH" -eq 1 ]]; then
    nohup bash -c "$(declare -f run_claude); run_claude" >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "started pid=$(cat "$PIDFILE") log=$LOG"
else
    run_claude
fi
