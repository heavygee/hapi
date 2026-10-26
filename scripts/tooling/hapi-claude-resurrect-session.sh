#!/usr/bin/env bash
# hapi-claude-resurrect-session
#
# Bring a Claude HAPI session back when the native Claude transcript is gone
# (hub still has scrollback; metadata.claudeSessionId points at a missing
# ~/.claude/projects/<slug>/<uuid>.jsonl). Sibling of hapi-resurrect-session
# (Cursor) — see docs/operator/session-resurrection.md § Claude orphans.
#
# Hub resume/reopen correctly fail closed with resume_unavailable. This tool
# is the operator path around that:
#   1. Confirm flavor=claude and (unless --force) that the jsonl is missing
#   2. Patch metadata: drop dead claudeSessionId / hostPid; un-archive
#   3. Restart hub --no-runner so the in-memory cache reloads
#   4. Attach a FRESH Claude CLI to the same HAPI session id (no --resume)
#   5. Ping a mandatory context-ingest remit (hub transcript is authoritative;
#      the new Claude process starts empty)
#
# Usage:
#   hapi-claude-resurrect-session <hapi-session-id-or-prefix>
#       [--dir <working-dir>]       # override metadata.path
#       [--name '<friendly label>']
#       [--force]                   # attach fresh even if jsonl still on disk
#       [--skip-ingest]             # attach only; no context remit
#       [--no-attach]               # metadata + hub restart only
#       [--no-restart-hub]
#       [--dry-run]
#       [--foreground]              # Claude attach in foreground (debug)
#
# Env:
#   HAPI_DB          default /var/lib/hapi/hapi.db (oos soup hub)
#   HAPI_SETTINGS    default /var/lib/hapi/settings.json
#   HAPI_HUB_URL     default http://127.0.0.1:3006
#   HAPI_ACTIVE / HAPI_DRIVER_CLI  driver cli for bun runClaude
#
# Exit codes:
#   0  resurrected (or dry-run / already-resumable reported)
#   1  session not found / not claude / working dir missing
#   2  usage / settings / db error
#   3  attach or ingest failed
#   4  transcript still on disk (refused without --force)
#
set -euo pipefail
export PATH="/home/heavygee/.bun/bin:/home/heavygee/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

DB="${HAPI_DB:-/var/lib/hapi/hapi.db}"
[[ -r "$DB" ]] || DB="${HOME}/.hapi/hapi.db"
SETTINGS="${HAPI_SETTINGS:-/var/lib/hapi/settings.json}"
[[ -r "$SETTINGS" ]] || SETTINGS="${HOME}/.hapi/settings.json"
HUB="${HAPI_HUB_URL:-${HAPI_API_URL:-http://127.0.0.1:3006}}"

SESSION=""
DIR_OVERRIDE=""
NAME=""
FORCE=0
SKIP_INGEST=0
NO_ATTACH=0
NO_RESTART=0
DRY=0
FOREGROUND=0

usage() {
    sed -n '2,48p' "$0" | sed 's/^# \?//'
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)            DIR_OVERRIDE="$2"; shift 2 ;;
        --name)           NAME="$2"; shift 2 ;;
        --force)          FORCE=1; shift ;;
        --skip-ingest)    SKIP_INGEST=1; shift ;;
        --no-attach)      NO_ATTACH=1; shift ;;
        --no-restart-hub) NO_RESTART=1; shift ;;
        --dry-run)        DRY=1; shift ;;
        --foreground)     FOREGROUND=1; shift ;;
        -h|--help)        usage ;;
        -*)               echo "unknown flag: $1" >&2; usage ;;
        *)                SESSION="$1"; shift ;;
    esac
done

[[ -n "$SESSION" ]] || usage
[[ -r "$DB" ]] || { echo "DB not readable: $DB" >&2; exit 2; }
[[ -r "$SETTINGS" ]] || { echo "settings not readable: $SETTINGS" >&2; exit 2; }

log() { printf '[hapi-claude-resurrect-session] %s\n' "$*"; }

# Python exits 4 when transcript is still on disk (refuse without --force).
# Capture that without `set -e` aborting before we print the plan.
set +e
PLAN_JSON="$(
DB="$DB" HUB="$HUB" SETTINGS="$SETTINGS" SESSION="$SESSION" \
DIR_OVERRIDE="$DIR_OVERRIDE" NAME="$NAME" FORCE="$FORCE" DRY="$DRY" \
python3 - <<'PY'
import json, os, sqlite3, sys, time
from pathlib import Path

DB = os.environ["DB"]
SESSION = os.environ["SESSION"].strip()
DIR_OVERRIDE = os.environ.get("DIR_OVERRIDE", "").strip()
NAME = os.environ.get("NAME", "").strip()
FORCE = os.environ.get("FORCE", "0") == "1"
DRY = os.environ.get("DRY", "0") == "1"


def die(code, msg):
    sys.stderr.write(f"[hapi-claude-resurrect-session] ERROR: {msg}\n")
    sys.exit(code)


def encode_project_id(path: str) -> str:
    # Match cli/src/claude/utils/claudeCheckSession.ts encodeProjectId
    return "".join(ch if ch.isalnum() else "-" for ch in os.path.abspath(path))


def project_slugs(workspace: str) -> list[str]:
    slugs = []
    for path in (os.path.abspath(workspace), os.path.realpath(workspace)):
        slug = encode_project_id(path)
        if slug not in slugs:
            slugs.append(slug)
    return slugs


def transcript_on_disk(csid: str, workspace: str, home: str | None = None) -> bool:
    if not csid or "/" in csid or "\\" in csid:
        return False
    home = home or str(Path.home())
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    projects_root = Path(config_dir) / "projects" if config_dir else Path(home) / ".claude" / "projects"
    if not projects_root.is_dir():
        return False
    # Prefer workspace drawers, then cross-project UUID scan (Claude --resume does this).
    candidates = []
    if workspace:
        for slug in project_slugs(workspace):
            candidates.append(projects_root / slug / f"{csid}.jsonl")
    for drawer in projects_root.iterdir():
        if drawer.is_dir():
            candidates.append(drawer / f"{csid}.jsonl")
    seen = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and path.stat().st_size > 0:
            # Cheap validity: any non-empty file counts (full uuid-line probe is overkill here)
            return True
    return False


con = sqlite3.connect(DB)
rows = con.execute(
    "SELECT id, metadata, metadata_version, active FROM sessions WHERE id LIKE ?",
    (f"{SESSION}%",),
).fetchall()
if not rows:
    die(1, f"no session matches prefix {SESSION!r}")
if len(rows) > 1:
    die(1, "multiple sessions match " + repr(SESSION) + ": " + ", ".join(r[0][:8] for r in rows))

sid, raw_meta, mver, active = rows[0][0], rows[0][1], int(rows[0][2] or 1), int(rows[0][3] or 0)
md = json.loads(raw_meta or "{}")
if md.get("flavor") != "claude":
    die(1, f"session {sid[:8]} flavor={md.get('flavor')!r} (want claude)")

workdir = DIR_OVERRIDE or md.get("path") or ""
if not workdir:
    die(1, "session has no metadata.path; pass --dir")
if not DRY and not os.path.isdir(workdir):
    die(1, f"working dir missing: {workdir}")

csid = md.get("claudeSessionId")
on_disk = bool(csid) and transcript_on_disk(csid, workdir, md.get("homeDir"))

if on_disk and not FORCE:
    plan = {
        "sessionId": sid,
        "action": "refuse_transcript_present",
        "claudeSessionId": csid,
        "hint": "Native transcript is on disk — use hub Resume / hapi-claude-rebind-session, or pass --force for a fresh Claude on this row.",
    }
    print(json.dumps(plan, indent=2))
    sys.exit(4)

before = {
    "lifecycleState": md.get("lifecycleState"),
    "claudeSessionId": csid,
    "hostPid": md.get("hostPid"),
    "archivedBy": md.get("archivedBy"),
    "archiveReason": md.get("archiveReason"),
    "path": md.get("path"),
    "name": md.get("name"),
    "active": bool(active),
}

md.pop("claudeSessionId", None)
md.pop("hostPid", None)
md["lifecycleState"] = "inactive"
md["lifecycleStateSince"] = int(time.time() * 1000)
md.pop("archivedBy", None)
md.pop("archiveReason", None)
if DIR_OVERRIDE:
    md["path"] = DIR_OVERRIDE
if NAME:
    md["name"] = NAME

new_v = mver + 1
plan = {
    "sessionId": sid,
    "action": "fresh_claude_attach",
    "workingDirectory": md.get("path"),
    "transcriptWasOnDisk": on_disk,
    "force": FORCE,
    "before": before,
    "after": {
        "lifecycleState": md["lifecycleState"],
        "claudeSessionId": None,
        "path": md.get("path"),
        "name": md.get("name"),
    },
    "metadata_version": f"{mver} -> {new_v}",
    "dryRun": DRY,
}
print(json.dumps(plan, indent=2))

if DRY:
    sys.exit(0)

con.execute(
    "UPDATE sessions SET metadata=?, metadata_version=?, active=0, updated_at=? WHERE id=?",
    (json.dumps(md, separators=(",", ":")), new_v, int(time.time() * 1000), sid),
)
con.commit()
con.close()
sys.stderr.write("[hapi-claude-resurrect-session] metadata patched (cleared claudeSessionId).\n")
PY
)"
PY_RC=$?
set -e

if [[ -n "$PLAN_JSON" ]]; then
    echo "$PLAN_JSON"
fi
if [[ "$PY_RC" -ne 0 && "$PY_RC" -ne 4 ]]; then
    exit "$PY_RC"
fi

ACTION="$(echo "$PLAN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("action",""))')"
FULL_SID="$(echo "$PLAN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')"
WORKDIR="$(echo "$PLAN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("workingDirectory") or "")')"

if [[ "$ACTION" == "refuse_transcript_present" || "$PY_RC" -eq 4 ]]; then
    log "refusing: transcript still on disk (pass --force to override)"
    exit 4
fi

if [[ "$DRY" -eq 1 ]]; then
    log "dry-run complete."
    exit 0
fi

if [[ "$NO_RESTART" -eq 0 ]]; then
    log "restarting hub --no-runner so metadata cache reloads..."
    hapi-restart-hub --no-runner
    for _ in $(seq 1 20); do
        curl -fsS "$HUB/" >/dev/null 2>&1 && break
        sleep 1
    done
    sleep 2
fi

if [[ "$NO_ATTACH" -eq 1 ]]; then
    log "skipping attach (--no-attach). Session $FULL_SID metadata is ready for a fresh Claude."
    exit 0
fi

# Prefer explicit driver CLI. Never use a feature worktree as the Claude host —
# `HAPI_ACTIVE` in agent shells often points at the wrong checkout.
DRIVER_CLI="${HAPI_DRIVER_CLI:-}"
if [[ -z "$DRIVER_CLI" || ! -d "$DRIVER_CLI" ]]; then
    for candidate in \
        "$HOME/coding/hapi/driver/cli" \
        "/work/coding/hapi/driver/cli" \
        "$(readlink -f "$HOME/coding/hapi/active" 2>/dev/null)/cli"
    do
        if [[ -n "$candidate" && -f "$candidate/src/ui/tokenInit.ts" ]]; then
            DRIVER_CLI="$candidate"
            break
        fi
    done
fi
[[ -f "$DRIVER_CLI/src/ui/tokenInit.ts" ]] || { log "ERROR: driver cli missing tokenInit under: ${DRIVER_CLI:-unset}"; exit 2; }

export CLI_API_TOKEN
CLI_API_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
export HAPI_API_URL="$HUB"
# Required by the nohup subshell (declare -f does not capture caller locals).
export FULL_SID WORKDIR DRIVER_CLI

LOG="/tmp/claude-resurrect-${FULL_SID:0:8}.log"
PIDFILE="/tmp/claude-resurrect-${FULL_SID:0:8}.pid"

attach_fresh() {
    cd "$WORKDIR"
    exec bun --cwd "$DRIVER_CLI" -e "
import { initializeToken } from './src/ui/tokenInit.ts';
import { authAndSetupMachineIfNeeded } from './src/ui/auth.ts';
import { runClaude } from './src/claude/runClaude.ts';
await initializeToken();
await authAndSetupMachineIfNeeded();
await runClaude({
  existingSessionId: process.env.FULL_SID,
  workingDirectory: process.env.WORKDIR,
  startedBy: 'runner',
  startingMode: 'remote',
  permissionMode: 'bypassPermissions',
});
"
}

log "attaching fresh Claude to $FULL_SID (cwd=$WORKDIR cli=$DRIVER_CLI)..."
if [[ "$FOREGROUND" -eq 1 ]]; then
    attach_fresh
    exit 0
fi

: >"$LOG"
nohup env FULL_SID="$FULL_SID" WORKDIR="$WORKDIR" DRIVER_CLI="$DRIVER_CLI" \
    CLI_API_TOKEN="$CLI_API_TOKEN" HAPI_API_URL="$HAPI_API_URL" \
    bash -c "$(declare -f attach_fresh); attach_fresh" >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
log "started pid=$(cat "$PIDFILE") log=$LOG"

# Wait until hub API reports active (sqlite can lag the in-memory cache).
ok=0
JWT=""
if JWT="$(curl -fsS --max-time 10 -X POST "$HUB/api/auth" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$(jq -r .cliApiToken "$SETTINGS")" '{accessToken:$t}')" \
    | jq -r .token)"; then
    :
else
    JWT=""
fi
for _ in $(seq 1 90); do
    if [[ -n "$JWT" ]]; then
        state="$(curl -fsS --max-time 5 -H "Authorization: Bearer $JWT" \
            "$HUB/api/sessions/$FULL_SID" 2>/dev/null \
            | jq -r '.session.active // empty')"
        if [[ "$state" == "true" ]]; then
            ok=1
            break
        fi
    else
        state="$(sqlite3 "$DB" "SELECT active FROM sessions WHERE id='$FULL_SID'")"
        if [[ "$state" == "1" ]]; then
            ok=1
            break
        fi
    fi
    # Fail fast if attach process already exited
    if [[ -f "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        log "ERROR: attach process exited early — see $LOG"
        tail -20 "$LOG" >&2 || true
        exit 3
    fi
    sleep 1
done
if [[ "$ok" -ne 1 ]]; then
    log "ERROR: session did not become active within 90s — see $LOG"
    tail -20 "$LOG" >&2 || true
    exit 3
fi
log "session active."

if [[ "$SKIP_INGEST" -eq 1 ]]; then
    log "skipping ingest remit (--skip-ingest). DONE: $FULL_SID"
    exit 0
fi

INGEST_MSG="$(cat <<EOF
**Claude orphan resurrect.** Your native Claude transcript was gone from disk; you are a **fresh** Claude process on the same HAPI session id (\`${FULL_SID}\`). Hub scrollback for this session is intact — your model context is not.

Before any other work:
1. Retrieve this session's HAPI message history (hub transcript — authoritative).
2. Reconstruct goals, decisions, open tasks, and blockers from that history. Do not invent prior state.
3. Reply with a short **context restored** summary (what the session was doing + what is still open), then continue the prior remit if one is clear; otherwise ask the operator what to do next.

Tools: prefer hub/MCP session inspect or equivalent read of this session's messages. The UI history you share with the operator is the source of truth.
EOF
)"

if command -v hapi-ping-peer >/dev/null 2>&1; then
    log "delivering context-ingest remit via hapi-ping-peer..."
    # Already active — ping should not need resume; still fine if it resumes.
    if hapi-ping-peer "$FULL_SID" --message-file - <<<"$INGEST_MSG"; then
        log "ingest remit delivered."
    else
        log "WARN: hapi-ping-peer failed; deliver the ingest remit manually."
        exit 3
    fi
else
    log "WARN: hapi-ping-peer not on PATH; session is live but ingest remit was not sent."
    exit 3
fi

log "DONE. Open in HAPI web UI: /sessions/$FULL_SID"
log "  (fresh Claude + mandatory hub-transcript ingest in flight)"
