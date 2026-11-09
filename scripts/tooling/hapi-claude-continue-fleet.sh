#!/usr/bin/env bash
# hapi-claude-continue-fleet — continue-only wake for API-active Claude sessions.
#
# Auth cutover (toggle + reopen-mismatch) kills mid-turn work. Reopen brings a
# live process back on the new token but does NOT resume the agent — something
# must send a user message. This is that wake. Prefer continue-only; no ack-for-ack.
#
# Usage:
#   hapi-claude-continue-fleet
#   hapi-claude-continue-fleet --dry-run
#   hapi-claude-continue-fleet --message 'Continue. …'

set -euo pipefail
export PATH="/usr/bin:/bin:${HOME}/.local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

DRY=0
MSG='Continue. Auth was rotated to the other Claude slot; resume your prior work. No ack needed.'

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --message) MSG="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -16
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

SELF="${HAPI_SESSION_ID:-}"
PING_BIN="$(command -v hapi-ping-peer || true)"
[[ -n "$PING_BIN" ]] || PING_BIN="$SCRIPT_DIR/hapi-ping-peer.sh"
[[ -x "$PING_BIN" || -f "$PING_BIN" ]] || { echo "hapi-ping-peer not found" >&2; exit 2; }

mapfile -t IDS < <(python3 - "$HAPI_HOST" "$SELF" <<'PY'
import json, os, sys, urllib.request
host, self_id = sys.argv[1], sys.argv[2]
settings = json.load(open(os.path.expanduser("~/.hapi/settings.json")))
jwt = json.loads(urllib.request.urlopen(urllib.request.Request(
    host + "/api/auth",
    data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
), timeout=15).read())["token"]
for s in json.loads(urllib.request.urlopen(urllib.request.Request(
    host + "/api/sessions?limit=500",
    headers={"Authorization": f"Bearer {jwt}"},
), timeout=30).read())["sessions"]:
    if not s.get("active"):
        continue
    if (s.get("metadata") or {}).get("flavor") != "claude":
        continue
    if self_id and s["id"] == self_id:
        continue
    print(s["id"])
PY
)

echo "continue-fleet targets=${#IDS[@]} dry=$DRY"
ok=0
fail=0
for sid in "${IDS[@]}"; do
    if [[ "$DRY" -eq 1 ]]; then
        echo "WOULD ping ${sid:0:8}"
        ok=$((ok + 1))
        continue
    fi
    if "$PING_BIN" "$sid" "$MSG" >/dev/null 2>&1; then
        echo "OK ${sid:0:8}"
        ok=$((ok + 1))
    else
        echo "FAIL ${sid:0:8}"
        fail=$((fail + 1))
    fi
    sleep 0.25
done
echo "== continue-fleet ok=$ok fail=$fail =="
exit "$([[ "$fail" -eq 0 ]] && echo 0 || echo 1)"
