#!/usr/bin/env bash
# hapi-serial-reopen-verify — serial reopen → smoke → re-archive for Cursor sessions.
#
# Goal: prove archived Cursor rows with cursorSessionId can resume without
# blowing memory (one at a time). Default: dry-run list only.
#
# Usage:
#   hapi-serial-reopen-verify                 # list candidates
#   hapi-serial-reopen-verify --run           # reopen / GET /archive cycle
#   hapi-serial-reopen-verify --run --limit 6
#   hapi-serial-reopen-verify --ids id1,id2
#
# Env:
#   HAPI_HUB_URL          default http://127.0.0.1:3006
#   HAPI_SETTINGS         default ~/.hapi/settings.json
#   HAPI_DB               default /var/lib/hapi/hapi.db
#   HAPI_REOPEN_SLEEP     seconds between sessions (default 3)
#   HAPI_REOPEN_VERIFY_TIMEOUT  curl max-time for reopen (default 120)

set -euo pipefail

HUB="${HAPI_HUB_URL:-http://127.0.0.1:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
DB="${HAPI_DB:-/var/lib/hapi/hapi.db}"
SLEEP_SECS="${HAPI_REOPEN_SLEEP:-3}"
CURL_MAX="${HAPI_REOPEN_VERIFY_TIMEOUT:-120}"
RUN=0
LIMIT=0
IDS=""
LOG="${HAPI_REOPEN_LOG:-/tmp/hapi-serial-reopen-verify-$(date +%Y%m%d-%H%M%S).log}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --run) RUN=1; shift ;;
        --limit) LIMIT="${2:?}"; shift 2 ;;
        --ids) IDS="${2:?}"; shift 2 ;;
        --log) LOG="${2:?}"; shift 2 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

command -v jq >/dev/null
command -v sqlite3 >/dev/null
[[ -f "$SETTINGS" ]] || { echo "missing $SETTINGS" >&2; exit 1; }
[[ -r "$DB" ]] || { echo "cannot read $DB" >&2; exit 1; }

CLI_TOKEN="$(jq -r .cliApiToken "$SETTINGS")"
JWT="$(curl -fsS --max-time 30 -X POST "$HUB/api/auth" -H 'Content-Type: application/json' \
    -d "{\"accessToken\":\"$CLI_TOKEN\"}" | jq -r .token)"
AUTH=(-H "Authorization: Bearer $JWT" -H 'Content-Type: application/json')

list_candidates() {
    if [[ -n "$IDS" ]]; then
        local id
        IFS=',' read -ra arr <<< "$IDS"
        for id in "${arr[@]}"; do
            id="${id// /}"
            [[ -n "$id" ]] && echo "$id"
        done
        return
    fi
    sqlite3 "$DB" <<'SQL'
SELECT id FROM sessions
WHERE json_extract(metadata,'$.lifecycleState') = 'archived'
  AND json_extract(metadata,'$.cursorSessionId') IS NOT NULL
  AND length(json_extract(metadata,'$.cursorSessionId')) > 0
ORDER BY updated_at DESC;
SQL
}

candidates=()
while IFS= read -r line; do
    [[ -n "$line" ]] && candidates+=("$line")
done < <(list_candidates)

if (( LIMIT > 0 && ${#candidates[@]} > LIMIT )); then
    candidates=("${candidates[@]:0:$LIMIT}")
fi

echo "candidates=${#candidates[@]}  run=$RUN  log=$LOG" | tee "$LOG"

ok=0 fail=0 skip=0
for sid in "${candidates[@]}"; do
    meta="$(sqlite3 "$DB" "SELECT json_extract(metadata,'$.name'), json_extract(metadata,'$.path'), json_extract(metadata,'$.cursorSessionId') FROM sessions WHERE id='$sid';")"
    name="$(printf '%s' "$meta" | cut -d'|' -f1)"
    path="$(printf '%s' "$meta" | cut -d'|' -f2)"
    csid="$(printf '%s' "$meta" | cut -d'|' -f3)"
    echo "---- $sid  name=${name:-?}  path=${path:-?}  csid=${csid:0:8}…" | tee -a "$LOG"

    if [[ "$RUN" -ne 1 ]]; then
        skip=$((skip + 1))
        continue
    fi

    # Reopen
    reopen_body="$(curl -sS --max-time "$CURL_MAX" -w '\n%{http_code}' -X POST \
        "$HUB/api/sessions/$sid/reopen" "${AUTH[@]}" -d '{}' || true)"
    http="$(printf '%s' "$reopen_body" | tail -n1)"
    body="$(printf '%s' "$reopen_body" | sed '$d')"
    echo "  reopen HTTP $http" | tee -a "$LOG"
    if [[ "$http" != "200" ]]; then
        echo "  FAIL reopen: $(printf '%s' "$body" | head -c 400)" | tee -a "$LOG"
        fail=$((fail + 1))
        sleep "$SLEEP_SECS"
        continue
    fi

    # Smoke: session GET must be 200 and active/thinking readable
    get_body="$(curl -sS --max-time 30 -w '\n%{http_code}' \
        "$HUB/api/sessions/$sid" "${AUTH[@]}" || true)"
    ghttp="$(printf '%s' "$get_body" | tail -n1)"
    gjson="$(printf '%s' "$get_body" | sed '$d')"
    active="$(printf '%s' "$gjson" | jq -r '.active // empty' 2>/dev/null || true)"
    echo "  get HTTP $ghttp active=$active" | tee -a "$LOG"
    if [[ "$ghttp" != "200" ]]; then
        echo "  FAIL get after reopen" | tee -a "$LOG"
        fail=$((fail + 1))
        # best-effort archive anyway
        curl -sS --max-time 60 -X POST "$HUB/api/sessions/$sid/archive" "${AUTH[@]}" -d '{}' >/dev/null || true
        sleep "$SLEEP_SECS"
        continue
    fi

    # Brief settle so runner/ACP isn't mid-flight when we archive
    sleep 2

    arch_body="$(curl -sS --max-time 60 -w '\n%{http_code}' -X POST \
        "$HUB/api/sessions/$sid/archive" "${AUTH[@]}" -d '{}' || true)"
    ahttp="$(printf '%s' "$arch_body" | tail -n1)"
    echo "  archive HTTP $ahttp" | tee -a "$LOG"
    if [[ "$ahttp" != "200" && "$ahttp" != "204" ]]; then
        echo "  FAIL archive: $(printf '%s' "$arch_body" | sed '$d' | head -c 300)" | tee -a "$LOG"
        fail=$((fail + 1))
    else
        # confirm csid still present
        csid_after="$(sqlite3 "$DB" "SELECT json_extract(metadata,'$.cursorSessionId') FROM sessions WHERE id='$sid'")"
        if [[ -z "$csid_after" || "$csid_after" == "null" ]]; then
            echo "  FAIL cursorSessionId missing after archive" | tee -a "$LOG"
            fail=$((fail + 1))
        else
            echo "  OK (csid preserved)" | tee -a "$LOG"
            ok=$((ok + 1))
        fi
    fi
    sleep "$SLEEP_SECS"
done

echo "done ok=$ok fail=$fail listed_only=$skip total=${#candidates[@]}" | tee -a "$LOG"
(( fail == 0 ))
