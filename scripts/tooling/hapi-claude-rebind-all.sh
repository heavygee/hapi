#!/usr/bin/env bash
# hapi-claude-rebind-all.sh — after claude auth swap + runner restart, reattach live
# Claude HAPI sessions so wrappers inherit the new CLAUDE_CODE_OAUTH_TOKEN.
#
# Running claude processes do NOT hot-reload auth. This script:
#   1. Finds runner-spawned `bun … claude --resume` wrappers still alive
#   2. SIGTERM them (same HAPI row; scrollback stays in hub + claude transcript)
#   3. POST /api/sessions/:id/resume for each mapped row (serialized)
#
# Usage:
#   hapi-claude-rebind-all.sh [--dry-run] [--limit N]
#
# Env: HAPI_HOST (default http://127.0.0.1:3006), HAPI_SETTINGS (~/.hapi/settings.json)
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

DRY=0
LIMIT=999
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --limit) LIMIT="$2"; shift 2 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
DB="${HAPI_DB:-/var/lib/hapi/hapi.db}"
WAIT_SECS="${HAPI_WAIT_ACTIVE_SECS:-90}"

[[ -r "$SETTINGS" ]] || { echo "missing settings: $SETTINGS" >&2; exit 2; }
[[ -r "$DB" ]] || { echo "missing db: $DB" >&2; exit 2; }

CLI_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
[[ -n "$CLI_TOKEN" && "$CLI_TOKEN" != null ]] || { echo "no cliApiToken in $SETTINGS" >&2; exit 2; }

ACCESS_JSON="$(curl -sS --max-time 10 -X POST "$HAPI_HOST/api/auth" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$CLI_TOKEN:default" '{accessToken:$t}')")"
JWT="$(echo "$ACCESS_JSON" | jq -r '.token // empty')"
[[ -n "$JWT" ]] || { echo "JWT exchange failed: $ACCESS_JSON" >&2; exit 2; }

hapi_get() { curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST$1"; }
hapi_post() { curl -sS --max-time 120 -X POST -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "$2" "$HAPI_HOST$1"; }

mapfile -t TARGETS < <(python3 <<PY
import re, sqlite3, subprocess
db = sqlite3.connect("$DB")
out = subprocess.check_output(["pgrep", "-af", "bun.*claude --resume"], text=True, errors="replace")
live = {}
for line in out.splitlines():
    m = re.search(r"^(\d+) .*claude --resume (\S+)", line)
    if not m or m.group(2).startswith("("):
        continue
    live[int(m.group(1))] = m.group(2)

rows = db.execute("""
  SELECT id, json_extract(metadata,'$.name'), json_extract(metadata,'$.claudeSessionId'),
         json_extract(metadata,'$.path'), json_extract(metadata,'$.hostPid')
  FROM sessions
  WHERE json_extract(metadata,'$.flavor')='claude'
""").fetchall()
by_pid = {int(r[4]): r for r in rows if r[4] and str(r[4]).isdigit()}
by_csid = {r[2]: r for r in rows if r[2]}
seen = set()
for pid, csid in sorted(live.items()):
    r = by_pid.get(pid) or by_csid.get(csid)
    if not r or r[0] in seen:
        continue
    seen.add(r[0])
    path = r[3] or "/home/heavygee"
    print(f"{r[0]}\t{pid}\t{path}\t{r[1] or '(unnamed)'}")
PY
)

COUNT="${#TARGETS[@]}"
echo "== hapi-claude-rebind-all: $COUNT live claude wrapper(s) mapped =="
if [[ "$COUNT" -eq 0 ]]; then
    echo "nothing to rebind"
    exit 0
fi

if [[ "$DRY" -eq 1 ]]; then
    printf '%s\n' "${TARGETS[@]}"
    exit 0
fi

n=0
for row in "${TARGETS[@]}"; do
    [[ "$n" -ge "$LIMIT" ]] && break
    IFS=$'\t' read -r SID PID SESSION_PATH NAME <<< "$row"
    n=$((n + 1))
    echo "-- [$n/$COUNT] $SID (${SID:0:8}) pid=$PID name=$NAME --"
    if kill -0 "$PID" 2>/dev/null; then
        echo "   stopping stale wrapper pid=$PID"
        kill -TERM "$PID" 2>/dev/null || true
        i=0
        while [[ $i -lt 15 ]] && kill -0 "$PID" 2>/dev/null; do
            /bin/sleep 1
            i=$((i + 1))
        done
        if kill -0 "$PID" 2>/dev/null; then
            echo "   SIGKILL pid=$PID"
            kill -KILL "$PID" 2>/dev/null || true
        fi
    fi
    /bin/sleep 1
    echo "   POST resume"
    RESUME="$(hapi_post "/api/sessions/$SID/resume" '{}')"
    if ! echo "$RESUME" | jq -e '.type == "success"' >/dev/null 2>&1; then
        echo "   WARNING resume failed: $RESUME"
        continue
    fi
    NEW_SID="$(echo "$RESUME" | jq -r '.sessionId // empty')"
    POLL_SID="${NEW_SID:-$SID}"
    if [[ -n "$NEW_SID" && "$NEW_SID" != "$SID" ]]; then
        echo "   resumed as new row ${NEW_SID:0:8} (hub merge path)"
    fi
    end=$(( $(date +%s) + WAIT_SECS ))
    ok=0
    while [[ $(date +%s) -lt $end ]]; do
        ACTIVE="$(hapi_get "/api/sessions/$POLL_SID" | jq -r '.session.active // false')"
        if [[ "$ACTIVE" == "true" ]]; then ok=1; break; fi
        /bin/sleep 2
    done
    if [[ "$ok" -eq 1 ]]; then
        echo "   OK active"
    else
        echo "   WARNING did not become active within ${WAIT_SECS}s"
    fi
done

echo "== rebind pass complete ($n processed) =="
