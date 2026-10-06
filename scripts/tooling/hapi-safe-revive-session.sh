#!/usr/bin/env bash
# hapi-safe-revive-session — reattach an inactive Cursor ACP session on its
# original HAPI row without spawn-then-merge (workaround for tiann/hapi#991).
#
# WHY: POST /api/sessions/:id/resume spawns a NEW row, waits for in-memory
# session-ready over socket.io, then mergeSessions. On tailnet hub topologies
# the ready event is often lost → HTTP 500 "Session failed to become ready".
#
# This script calls runCursor({ existingSessionId, resumeSessionId }) directly,
# which binds the original row and skips the broken hub resume path.
#
# TEMPORARY: delete or demote once #991 fix ships in soup. Distinct from
# hapi-resurrect-session.sh (legacy stream-json / missing cursorSessionId).
#
# Usage:
#   hapi-safe-revive-session <hapi-session-id> <working-dir> <cursor-session-id> [label]
#   hapi-safe-revive-session --detach ...   # default: background + pid/log files
#   hapi-safe-revive-session --foreground ... # block in foreground (debug)
#
# Env:
#   HAPI_API_URL     default from settings or http://127.0.0.1:3006
#   HAPI_SETTINGS    default ~/.hapi/settings.json
#   HAPI_DRIVER_CLI  default ~/coding/hapi/driver/cli (via hapi-active when set)
#
# Ops notes (2026-07-03 recovery):
#   - Launch ONE AT A TIME on memory-tight hosts; earlyoom kills 5th concurrent
#     ACP agent on proxmox (~32Gi, swap full).
#   - Do NOT wrap in timeout — cleanup archives as "Hub restart".
#   - If getSession fails validation, check agent_state.completedRequests for
#     entries missing required "arguments" (reset via hub DB on oos-linux).
#   - Hub in-memory cache can serve stale agent_state after DB patch; bounce
#     hapi-hub-oos on oos-linux (or SIGTERM hub pid) before retry.
#
set -euo pipefail

DETACH=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --detach) DETACH=1; shift ;;
        --foreground) DETACH=0; shift ;;
        -h|--help)
            sed -n '2,35p' "$0"
            exit 0
            ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) break ;;
    esac
done

HAPI_SESSION_ID="${1:-}"
WORKING_DIR="${2:-}"
CURSOR_SESSION_ID="${3:-}"
LABEL="${4:-safe-revive}"

[[ -n "$HAPI_SESSION_ID" && -n "$WORKING_DIR" && -n "$CURSOR_SESSION_ID" ]] || {
    echo "usage: hapi-safe-revive-session [--detach|--foreground] <hapi-id> <dir> <cursor-id> [label]" >&2
    exit 2
}
[[ -d "$WORKING_DIR" ]] || { echo "working dir missing: $WORKING_DIR" >&2; exit 2; }

SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
export CLI_API_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
export HAPI_API_URL="${HAPI_API_URL:-$(jq -r '.apiUrl // empty' "$SETTINGS" 2>/dev/null)}"
[[ -n "$HAPI_API_URL" ]] || export HAPI_API_URL="http://127.0.0.1:3006"

ACTIVE="$(readlink -f "${HAPI_ACTIVE:-$HOME/coding/hapi/active}" 2>/dev/null || echo "$HOME/coding/hapi/driver")"
DRIVER_CLI="${HAPI_DRIVER_CLI:-$ACTIVE/cli}"

LOG="/tmp/revive-${HAPI_SESSION_ID:0:8}-${LABEL}.log"
PIDFILE="/tmp/revive-${HAPI_SESSION_ID:0:8}.pid"

export WORKING_DIR DRIVER_CLI HAPI_SESSION_ID CURSOR_SESSION_ID

run_cursor() {
    cd "$WORKING_DIR"
    exec bun --cwd "$DRIVER_CLI" -e "
import { initializeToken } from './src/ui/tokenInit.ts';
import { authAndSetupMachineIfNeeded } from './src/ui/auth.ts';
import { runCursor } from './src/cursor/runCursor.ts';
await initializeToken();
await authAndSetupMachineIfNeeded();
await runCursor({
  existingSessionId: '${HAPI_SESSION_ID}',
  workingDirectory: '${WORKING_DIR}',
  resumeSessionId: '${CURSOR_SESSION_ID}',
  startedBy: 'runner',
  permissionMode: 'yolo',
});
"
}

if [[ "$DETACH" -eq 1 ]]; then
    nohup bash -c "$(declare -f run_cursor); run_cursor" >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "started pid=$(cat "$PIDFILE") log=$LOG"
else
    run_cursor
fi
