#!/usr/bin/env bash
# hapi-claude-heal-active.sh — assess + rebind all API-active Claude sessions.
#
# After auth swap, hub resume can leave zombie rows (active=true, no CLI) and
# orphan wrappers (CLI running, not bound to hub). This script:
#   1. Builds claudeSessionId + path for each active Claude row
#   2. Kills all stale bun claude wrappers
#   3. Direct-binds each row via hapi-claude-rebind-session.sh (serialized)
#
# Usage: hapi-claude-heal-active.sh [--dry-run] [--limit N] [--skip-kill]
set -euo pipefail
export PATH="/home/heavygee/.bun/bin:/home/heavygee/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REBIND="$SCRIPT_DIR/hapi-claude-rebind-session.sh"
DRY=0
LIMIT=999
SKIP_KILL=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --limit) LIMIT="$2"; shift 2 ;;
        --skip-kill) SKIP_KILL=1; shift ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
DB="${HAPI_DB:-/var/lib/hapi/hapi.db}"
WAIT_SECS="${HAPI_HEAL_WAIT_SECS:-45}"

mapfile -t PLAN < <(python3 <<PY
import json, os, re, sqlite3, subprocess, urllib.request

settings = json.load(open(os.path.expanduser("$SETTINGS")))
req = urllib.request.Request("$HAPI_HOST/api/auth", data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(), headers={"Content-Type": "application/json"}, method="POST")
jwt = json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]
sessions = json.loads(urllib.request.urlopen(urllib.request.Request("$HAPI_HOST/api/sessions?limit=500", headers={"Authorization": f"Bearer {jwt}"}), timeout=30).read())["sessions"]
active = [s for s in sessions if s.get("metadata", {}).get("flavor") == "claude" and s.get("active")]

db = sqlite3.connect("$DB")

def extract_csid(obj):
    if isinstance(obj, dict):
        for k in ("session_id", "sessionId"):
            v = obj.get(k)
            if isinstance(v, str) and re.match(r"^[0-9a-f-]{36}$", v, re.I):
                return v
        for v in obj.values():
            r = extract_csid(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = extract_csid(v)
            if r:
                return r
    return None

def recover_from_messages(session_id):
    rows = db.execute("SELECT content FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 200", (session_id,)).fetchall()
    for (content,) in rows:
        if not content:
            continue
        try:
            parsed = json.loads(content) if isinstance(content, str) else content
        except Exception:
            parsed = content
        found = extract_csid(parsed)
        if found:
            return found
    return None

# orphan wrapper csids
out = subprocess.check_output(["pgrep", "-af", "bun.*claude --resume"], text=True, errors="replace")
orphan_by_name = {}
orphan_csids_sorted = []
for line in out.splitlines():
    m = re.search(r"^(\d+) .*claude --resume (\S+)", line)
    if m and not m.group(2).startswith("("):
        orphan_csids_sorted.append((int(m.group(1)), m.group(2)))
orphan_csids_sorted.sort(key=lambda x: x[0])
orphan_csid_list = [csid for _, csid in orphan_csids_sorted]

for csid in orphan_csid_list:
    row = db.execute("SELECT json_extract(metadata,'$.name') FROM sessions WHERE json_extract(metadata,'$.claudeSessionId')=? ORDER BY updated_at DESC LIMIT 1", (csid,)).fetchone()
    if row and row[0]:
        orphan_by_name[row[0]] = csid

missing_active = []
resolved_rows = []
for s in sorted(active, key=lambda x: -(x.get("updatedAt") or 0)):
    sid = s["id"]
    md = s.get("metadata", {})
    name = md.get("name") or "?"
    path = md.get("path")
    if not path:
        row = db.execute("SELECT json_extract(metadata,'$.path') FROM sessions WHERE id=?", (sid,)).fetchone()
        path = row[0] if row else None
    path = path or "/home/heavygee"
    csid = md.get("claudeSessionId") or recover_from_messages(sid) or orphan_by_name.get(name)
    if not csid:
        hist = db.execute("""
          SELECT json_extract(metadata,'$.claudeSessionId') FROM sessions
          WHERE json_extract(metadata,'$.name')=? AND json_extract(metadata,'$.claudeSessionId') IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1
        """, (name,)).fetchone()
        csid = hist[0] if hist else None
    if not csid:
        missing_active.append((s.get("updatedAt") or 0, sid, path, name))
        continue
    resolved_rows.append((sid, csid, path, name))

# Pair orphan csids (rebind spawns) with active rows that never got metadata.claudeSessionId
assigned_csids = {csid for _, csid, _, _ in resolved_rows}
unused_orphans = [c for c in orphan_csid_list if c not in assigned_csids]
missing_active.sort(key=lambda x: x[0])
if len(unused_orphans) == len(missing_active):
    for (_, sid, path, name), csid in zip(missing_active, unused_orphans):
        resolved_rows.append((sid, csid, path, name))
else:
    for _, sid, path, name in missing_active:
        print(f"SKIP\t{sid}\t\t\t{name}\tno claudeSessionId", flush=True)

for sid, csid, path, name in resolved_rows:
    print(f"REBIND\t{sid}\t{csid}\t{path}\t{name}", flush=True)
PY
)

echo "== hapi-claude-heal-active: plan ${#PLAN[@]} row(s) =="
SKIP=0
REBIND_N=0
for row in "${PLAN[@]}"; do
    IFS=$'\t' read -r action SID CSID SESSION_PATH NAME <<< "$row"
    if [[ "$action" == SKIP ]]; then
        echo "SKIP ${SID:0:8} $NAME (no claudeSessionId)"
        SKIP=$((SKIP + 1))
        continue
    fi
    echo "PLAN ${SID:0:8} csid=${CSID:0:8} $NAME"
    REBIND_N=$((REBIND_N + 1))
done

if [[ "$DRY" -eq 1 ]]; then
    echo "dry-run: would rebind $REBIND_N session(s), skip $SKIP"
    exit 0
fi

if [[ "$SKIP_KILL" -eq 0 ]]; then
    echo "-- killing stale bun claude wrappers --"
    pkill -TERM -f 'bun.*claude --resume' 2>/dev/null || true
    /bin/sleep 3
    pkill -KILL -f 'bun.*claude --resume' 2>/dev/null || true
    /bin/sleep 1
fi

CLI_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
JWT="$(curl -sS --max-time 10 -X POST "$HAPI_HOST/api/auth" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$CLI_TOKEN:default" '{accessToken:$t}')" | jq -r '.token')"

n=0
ok=0
fail=0
for row in "${PLAN[@]}"; do
    [[ "$n" -ge "$LIMIT" ]] && break
    IFS=$'\t' read -r action SID CSID SESSION_PATH NAME <<< "$row"
    [[ "$action" == "REBIND" ]] || continue
    n=$((n + 1))
    echo "-- [$n] rebind ${SID:0:8} $NAME --"
    OUT="$("$REBIND" --detach "$SID" "$SESSION_PATH" "$CSID" "heal-$n" 2>&1)" || true
    echo "$OUT"
    bun_pid="$(echo "$OUT" | sed -n 's/^started pid=\([0-9]*\).*/\1/p')"
    end=$(( $(date +%s) + WAIT_SECS ))
    bound=0
    while [[ $(date +%s) -lt $end ]]; do
        ACTIVE="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$SID" \
            | jq -r '.session.active // false')"
        HP="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$SID" \
            | jq -r '.session.metadata.hostPid // empty')"
        if [[ "$ACTIVE" == "true" && -n "$HP" ]]; then
            bound=1
            break
        fi
        /bin/sleep 2
    done
    if [[ "$bound" -eq 1 ]]; then
        echo "   OK bound hostPid=$HP"
        ok=$((ok + 1))
    else
        echo "   FAIL not bound within ${WAIT_SECS}s (see /tmp/rebind-${SID:0:8}-heal-$n.log)"
        fail=$((fail + 1))
    fi
done

echo "== heal complete: ok=$ok fail=$fail skip=$SKIP =="
