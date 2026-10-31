#!/usr/bin/env bash
# hapi-cursor-store-census — which Cursor sessions can still be reopened?
#
# READ-ONLY. Replicates the hub's resume gate (cli/src/cursor/cursorChatStoreStatus.ts
# inspectCursorChatStore) against every Cursor session row in the hub DB, so you can
# see the casualty list BEFORE switching Cursor accounts, rotating credentials, or
# bulk-changing session models — instead of discovering it on the next reopen.
#
# A session is reported MISSING when the probe finds no store.db, which is exactly
# when `resumeSession` returns `resume_unavailable`. Two very different causes:
#
#   never_persisted  thread dir exists, store.db absent — the agent never completed
#                    a turn (provider refusal, usage limit, crash on first turn).
#                    Nothing was lost; the thread was never resumable. See #2184.
#   removed          thread dir absent — the store existed and is gone (Cursor GC,
#                    manual cleanup). This is the #841 case.
#
# Exit codes:
#   0  every probed Cursor session still has a store on disk
#   1  one or more sessions would fail resume
#   2  usage / setup error
#
# Usage:
#   hapi-cursor-store-census                 # local host, table
#   hapi-cursor-store-census --all-hosts     # include SSH fleet hosts
#   hapi-cursor-store-census --json          # machine-readable rows
#   hapi-cursor-store-census --quiet         # casualties only
#   hapi-cursor-store-census --db <path>     # override hub DB

set -euo pipefail

FORMAT=table
QUIET=0
ALL_HOSTS=0
DB_PATH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)      FORMAT=json; shift ;;
        --quiet)     QUIET=1; shift ;;
        --all-hosts) ALL_HOSTS=1; shift ;;
        --db)        DB_PATH="${2:-}"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -30
            exit 0
            ;;
        *) echo "hapi-cursor-store-census: unknown arg: $1" >&2; exit 2 ;;
    esac
done

# Hub DB: never guess ~/.hapi/hapi.db — that is a scream stub on this estate.
if [[ -z "$DB_PATH" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -r "${SCRIPT_DIR}/lib/hapi-systemd-units.sh" ]]; then
        # shellcheck source=/dev/null
        source "${SCRIPT_DIR}/lib/hapi-systemd-units.sh"
        DB_PATH="$(hapi_systemd_hub_db_path 2>/dev/null || true)"
    fi
    [[ -n "$DB_PATH" ]] || DB_PATH=/var/lib/hapi/hapi.db
fi

if [[ ! -r "$DB_PATH" ]]; then
    echo "hapi-cursor-store-census: hub DB not readable: $DB_PATH" >&2
    exit 2
fi

command -v sqlite3 >/dev/null || { echo "hapi-cursor-store-census: sqlite3 required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "hapi-cursor-store-census: python3 required" >&2; exit 2; }

LOCAL_HOST="$(hostname)"
ROWS_TSV="$(mktemp)"
PROBE_PY="$(mktemp --suffix=.py)"
trap 'rm -f "$ROWS_TSV" "$PROBE_PY"' EXIT

# Only sessions with a recorded token reach the Cursor store probe in
# syncEngine.resumeSession (`flavor === 'cursor' && resumeToken`).
sqlite3 -readonly -separator $'\t' "file:${DB_PATH}?mode=ro" "
SELECT s.id,
       json_extract(s.metadata,'\$.cursorSessionId'),
       COALESCE(json_extract(s.metadata,'\$.path'),''),
       COALESCE(json_extract(s.metadata,'\$.homeDir'),''),
       COALESCE(json_extract(s.metadata,'\$.host'),''),
       COALESCE(json_extract(s.metadata,'\$.lifecycleState'),''),
       COALESCE(json_extract(s.metadata,'\$.name'),''),
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id)
FROM sessions s
WHERE json_extract(s.metadata,'\$.flavor')='cursor'
  AND COALESCE(json_extract(s.metadata,'\$.cursorSessionId'),'')<>''
ORDER BY json_extract(s.metadata,'\$.host'), s.created_at;
" > "$ROWS_TSV"

# Mirrors inspectCursorChatStore(): acp store, then legacy md5(workspacePath)
# drawer, then the unique-legacy fallback.
cat > "$PROBE_PY" <<'PYEOF'
import hashlib, os, re, sys

SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

def unique_legacy(home, sid):
    root = os.path.join(home, ".cursor", "chats")
    try:
        drawers = os.listdir(root)
    except OSError:
        return False
    hits = 0
    for drawer in drawers:
        if os.path.isfile(os.path.join(root, drawer, sid, "store.db")):
            hits += 1
            if hits > 1:
                return False
    return hits == 1

for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 4:
        continue
    sid, path, home = parts[1].strip(), parts[2], parts[3]
    home = home or os.path.expanduser("~")
    if sid in (".", "..") or not SAFE.match(sid) or not path:
        print(line.rstrip("\n") + "\tMISSING\tbad_input")
        continue
    if os.path.isfile(os.path.join(home, ".cursor", "acp-sessions", sid, "store.db")):
        print(line.rstrip("\n") + "\tOK\tacp")
        continue
    drawer = hashlib.md5(path.encode()).hexdigest()
    if os.path.isfile(os.path.join(home, ".cursor", "chats", drawer, sid, "store.db")):
        print(line.rstrip("\n") + "\tOK\tlegacy_hash")
        continue
    if unique_legacy(home, sid):
        print(line.rstrip("\n") + "\tOK\tlegacy_unique")
        continue
    thread_dir = os.path.join(home, ".cursor", "acp-sessions", sid)
    if os.path.isdir(thread_dir):
        cause = "never_persisted"
    else:
        cause = "removed"
    print(line.rstrip("\n") + "\tMISSING\t" + cause)
PYEOF

RESULTS="$(mktemp)"
trap 'rm -f "$ROWS_TSV" "$PROBE_PY" "$RESULTS"' EXIT

# Local host rows.
awk -F'\t' -v h="$LOCAL_HOST" '$5==h || $5==""' "$ROWS_TSV" | python3 "$PROBE_PY" > "$RESULTS" || true

if [[ "$ALL_HOSTS" -eq 1 ]]; then
    # Remote hosts: ship the same probe over SSH so one tool answers for the fleet.
    mapfile -t REMOTE_HOSTS < <(awk -F'\t' '{print $5}' "$ROWS_TSV" | sort -u)
    for remote in "${REMOTE_HOSTS[@]}"; do
        [[ -n "$remote" && "$remote" != "$LOCAL_HOST" ]] || continue
        if ! ssh -n -o BatchMode=yes -o ConnectTimeout=8 "$remote" 'command -v python3 >/dev/null' 2>/dev/null; then
            echo "hapi-cursor-store-census: skipping unreachable/incompatible host: $remote" >&2
            continue
        fi
        ssh -o BatchMode=yes -o ConnectTimeout=8 "$remote" 'cat > /tmp/hapi-store-probe.py' < "$PROBE_PY"
        awk -F'\t' -v h="$remote" '$5==h' "$ROWS_TSV" \
            | ssh -o BatchMode=yes -o ConnectTimeout=8 "$remote" 'python3 /tmp/hapi-store-probe.py' \
            >> "$RESULTS" || true
    done
fi

MISSING_COUNT="$(awk -F'\t' '$9=="MISSING"' "$RESULTS" | wc -l | tr -d ' ')"
TOTAL_COUNT="$(wc -l < "$RESULTS" | tr -d ' ')"

if [[ "$FORMAT" == json ]]; then
    python3 - "$RESULTS" <<'PYEOF'
import json, sys
rows = []
with open(sys.argv[1]) as fh:
    for line in fh:
        p = line.rstrip("\n").split("\t")
        if len(p) < 10:
            continue
        rows.append({
            "sessionId": p[0], "cursorSessionId": p[1], "path": p[2],
            "homeDir": p[3], "host": p[4], "lifecycleState": p[5],
            "name": p[6], "messages": int(p[7] or 0),
            "verdict": p[8], "cause": p[9],
        })
print(json.dumps({
    "total": len(rows),
    "resumable": sum(1 for r in rows if r["verdict"] == "OK"),
    "casualties": [r for r in rows if r["verdict"] == "MISSING"],
}, indent=1))
PYEOF
else
    if [[ "$MISSING_COUNT" -gt 0 ]]; then
        printf '%-10s  %-16s  %-10s  %-5s  %s\n' HOST CAUSE LIFECYCLE MSGS SESSION
        printf '%-10s  %-16s  %-10s  %-5s  %s\n' ---- ----- --------- ---- -------
        awk -F'\t' '$9=="MISSING"{
            printf "%-10s  %-16s  %-10s  %-5s  %s\n",
                   ($5==""?"?":$5), $10, ($6==""?"-":$6), $8,
                   substr($1,1,8) " " ($7==""?"(unnamed)":$7)
        }' "$RESULTS"
        echo
    fi
    if [[ "$QUIET" -eq 0 ]]; then
        echo "probed:    $TOTAL_COUNT Cursor sessions with a recorded cursorSessionId"
        echo "resumable: $((TOTAL_COUNT - MISSING_COUNT))"
        echo "casualties: $MISSING_COUNT"
        if [[ "$MISSING_COUNT" -gt 0 ]]; then
            echo
            echo "never_persisted = agent never completed a turn; nothing lost (see #2184)"
            echo "removed         = store existed and is gone (see #841)"
        fi
    fi
fi

[[ "$MISSING_COUNT" -eq 0 ]] || exit 1
