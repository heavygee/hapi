#!/usr/bin/env bash
# hapi-spawn-peer — spawn + rename + deliver handoff, or fail.
#
# Machine spawn does NOT accept a first message (SpawnSessionRequestSchema
# strips unknown keys). A sessionId with 0 user turns is an empty shell.
# This wrapper is the fail-closed path. Canon: docs/plans/2026-08-11-spawn-peer-empty-shell-postmortem.md
#
# Usage:
#   hapi-spawn-peer --dir PATH --name TITLE --message-file FILE
#   hapi-spawn-peer --dir PATH --name TITLE --message-file - <<'EOF'
#   …handoff…
#   EOF
#
# Options:
#   --agent cursor|claude|…     (default cursor)
#   --model ID                  (optional; forwarded to SpawnSessionRequest.model)
#   --effort LEVEL              (optional; forwarded to SpawnSessionRequest.effort)
#   --session-type simple|worktree  (default worktree when dir looks like a worktree)
#   --machine ID|hostname       (default: this host's settings.machineId)
#   --yolo / --no-yolo          (default yolo on)
#
# Prefer product CLI when available: `hapi spawn-peer --model … --effort …`
# (soup via ~/.local/bin/hapi). This wrapper exists for remit fail-closed until
# upstream #1511 merges; keep model/effort parity with hub + product CLI.
#
# Machine-to-machine: pass --machine oos-linux (or UUID) so spawn hits that
# runner. --dir must exist on the TARGET host. When --machine != local, the
# local [[ -d ]] check is skipped (target path is the contract).
set -euo pipefail

err() { echo "hapi-spawn-peer: $*" >&2; }
die() { err "$*"; exit 2; }

DIR=""
NAME=""
MESSAGE_FILE=""
AGENT="cursor"
MODEL=""
EFFORT=""
SESSION_TYPE=""
YOLO=1
MACHINE_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir) DIR="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        --message-file) MESSAGE_FILE="$2"; shift 2 ;;
        --agent) AGENT="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        --effort) EFFORT="$2"; shift 2 ;;
        --session-type) SESSION_TYPE="$2"; shift 2 ;;
        --machine) MACHINE_ARG="$2"; shift 2 ;;
        --yolo) YOLO=1; shift ;;
        --no-yolo) YOLO=0; shift ;;
        --help|-h)
            sed -n '2,28p' "$0"
            exit 0
            ;;
        *) die "unexpected arg: $1" ;;
    esac
done

[[ -n "$DIR" ]] || die "missing --dir"
[[ -n "$NAME" ]] || die "missing --name"
[[ -n "$MESSAGE_FILE" ]] || die "missing --message-file (use - for stdin)"

if [[ -z "$SESSION_TYPE" ]]; then
    if [[ "$DIR" == */worktrees/* ]]; then
        SESSION_TYPE="worktree"
    else
        SESSION_TYPE="simple"
    fi
fi

HAPI_HOST="${HAPI_HOST:-${HAPI_HUB_URL:-http://127.0.0.1:3006}}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
[[ -f "$SETTINGS" ]] || die "settings file not found: $SETTINGS"
RAW_TOKEN=$(jq -r '.cliApiToken // empty' "$SETTINGS")
LOCAL_MACHINE=$(jq -r '.machineId // empty' "$SETTINGS")
[[ -n "$RAW_TOKEN" ]] || die "no cliApiToken in $SETTINGS"
[[ -n "$LOCAL_MACHINE" ]] || die "no machineId in $SETTINGS"

JWT=$(curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$RAW_TOKEN:default" '{accessToken:$t}')" \
    "$HAPI_HOST/api/auth" | jq -r '.token // empty')
[[ -n "$JWT" ]] || die "JWT exchange failed ($HAPI_HOST)"

AUTH=(-H "Authorization: Bearer $JWT" -H 'Content-Type: application/json')

resolve_machine() {
    local want="$1"
    if [[ -z "$want" ]]; then
        echo "$LOCAL_MACHINE"
        return
    fi
    # Exact UUID
    if [[ "$want" =~ ^[0-9a-fA-F-]{36}$ ]]; then
        echo "$want"
        return
    fi
    # Hostname / metadata.host match (e.g. oos-linux, proxmox)
    local machines
    machines=$(curl -sS --max-time 10 "${AUTH[@]}" "$HAPI_HOST/api/machines") || die "GET /api/machines failed"
    local resolved
    resolved=$(echo "$machines" | jq -r --arg w "$want" '
      (.machines // .) as $m
      | ($m | if type=="array" then . else [] end)
      | map(select(
          (.id|tostring)==$w
          or ((.metadata.host // .hostname // .host // "")|tostring)==$w
          or ((.metadata.name // "")|tostring)==$w
        ))
      | .[0].id // empty
    ')
    [[ -n "$resolved" ]] || die "no hub machine matched --machine=$want (try UUID or hostname from GET /api/machines)"
    echo "$resolved"
}

MACHINE=$(resolve_machine "$MACHINE_ARG")
CROSS_HOST=0
if [[ "$MACHINE" != "$LOCAL_MACHINE" ]]; then
    CROSS_HOST=1
    err "cross-machine spawn: local=$LOCAL_MACHINE target=$MACHINE (dir must exist on TARGET)"
fi

if [[ "$CROSS_HOST" -eq 0 ]]; then
    [[ -d "$DIR" ]] || die "directory not found on this host: $DIR"
else
    if [[ -d "$DIR" ]]; then
        err "note: $DIR also exists locally; spawn still targets machine $MACHINE"
    else
        err "skipping local dir check (cross-machine); ensure $DIR exists on target"
    fi
fi

YOLO_JSON=true
[[ "$YOLO" == "1" ]] || YOLO_JSON=false

err "spawning agent=$AGENT type=$SESSION_TYPE dir=$DIR machine=$MACHINE${MODEL:+ model=$MODEL}${EFFORT:+ effort=$EFFORT}"
SPAWN=$(curl -sS --max-time 60 -X POST "${AUTH[@]}" \
    -d "$(jq -n \
        --arg dir "$DIR" \
        --arg agent "$AGENT" \
        --arg st "$SESSION_TYPE" \
        --arg model "$MODEL" \
        --arg effort "$EFFORT" \
        --argjson yolo "$YOLO_JSON" \
        '{directory:$dir, agent:$agent, sessionType:$st, yolo:$yolo}
         + (if $model == "" then {} else {model:$model} end)
         + (if $effort == "" then {} else {effort:$effort} end)')" \
    "$HAPI_HOST/api/machines/$MACHINE/spawn")

PEER_ID=$(echo "$SPAWN" | jq -r '.sessionId // empty')
if [[ -z "$PEER_ID" || "$PEER_ID" == "null" ]]; then
    err "spawn failed: $SPAWN"
    exit 3
fi
err "spawned $PEER_ID"

PATCH=$(curl -sS --max-time 10 -X PATCH "${AUTH[@]}" \
    -d "$(jq -n --arg n "$NAME" '{name:$n}')" \
    "$HAPI_HOST/api/sessions/$PEER_ID")
if ! echo "$PATCH" | jq -e '.ok == true' >/dev/null 2>&1; then
    err "rename failed (continuing to ping): $PATCH"
else
    err "renamed → $NAME"
fi

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
if [[ -n "${HAPI_PING_PEER:-}" ]]; then
    PING_BIN="$HAPI_PING_PEER"
elif command -v hapi-ping-peer >/dev/null 2>&1; then
    PING_BIN="$(command -v hapi-ping-peer)"
elif [[ -f "$SCRIPT_DIR/hapi-ping-peer.sh" ]]; then
    PING_BIN="$SCRIPT_DIR/hapi-ping-peer.sh"
elif [[ -x "$HOME/.local/bin/hapi-ping-peer" ]]; then
    PING_BIN="$HOME/.local/bin/hapi-ping-peer"
else
    die "hapi-ping-peer not found (PATH / $SCRIPT_DIR / ~/.local/bin)"
fi
[[ -x "$PING_BIN" || -f "$PING_BIN" ]] || die "hapi-ping-peer not executable: $PING_BIN"

err "delivering handoff via $PING_BIN (spawn JSON cannot carry message)"
if [[ "$MESSAGE_FILE" == "-" ]]; then
    "$PING_BIN" "$PEER_ID" --message-file -
else
    "$PING_BIN" "$PEER_ID" --message-file "$MESSAGE_FILE"
fi

# Fail closed: empty shell is a failed spawn even if ping "ok" raced.
sleep 1
MSGS=$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" \
    "$HAPI_HOST/api/sessions/$PEER_ID/messages?limit=5" || true)
COUNT=$(echo "$MSGS" | jq '(.messages // .) | if type=="array" then length else 0 end' 2>/dev/null || echo 0)
if [[ "${COUNT:-0}" -lt 1 ]]; then
    err "VERIFY FAILED: session $PEER_ID still has no messages (empty shell)."
    err "  Re-run: hapi-ping-peer $PEER_ID --message-file <brief>"
    exit 4
fi

echo "hapi-spawn-peer: OK $PEER_ID  name=\"$NAME\"  messages>=$COUNT"
echo "$PEER_ID"
