#!/usr/bin/env bash
# hapi-claude-continue-fleet — selective continue-only wake for Claude sessions.
#
# Auth cutover kills mid-turn work. Reopen restores a live process on the new
# token but does not resume the agent. Blindly waking every active Claude
# floods the operator with "I didn't need that" replies from sessions that
# had already finished (lastNotify=done).
#
# Default: wake only sessions that look interrupted or still needing attention
# (see lib/hapi_claude_wake_classify.py). When used from reopen-mismatch, pass
# a pre-kill --ids-file so classification is not contaminated by the wake.
#
# Usage:
#   hapi-claude-continue-fleet                 # selective wake
#   hapi-claude-continue-fleet --all           # every active Claude (old behaviour)
#   hapi-claude-continue-fleet --ids-file PATH # exact id list (one uuid per line)
#   hapi-claude-continue-fleet --classify-only # print wake/skip JSON, no pings
#   hapi-claude-continue-fleet --dry-run
#   hapi-claude-continue-fleet --message '…'

set -euo pipefail
export PATH="/usr/bin:/bin:${HOME}/.local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

DRY=0
WAKE_ALL=0
CLASSIFY_ONLY=0
IDS_FILE=""
MSG='Continue. Auth was rotated to the other Claude slot; you were interrupted mid-flight — resume your prior work. No ack needed if you were already done.'

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --all) WAKE_ALL=1; shift ;;
        --classify-only) CLASSIFY_ONLY=1; shift ;;
        --ids-file) IDS_FILE="$2"; shift 2 ;;
        --message) MSG="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -22
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

SELF="${HAPI_SESSION_ID:-}"
PING_BIN="$(command -v hapi-ping-peer || true)"
[[ -n "$PING_BIN" ]] || PING_BIN="$SCRIPT_DIR/hapi-ping-peer.sh"
[[ -x "$PING_BIN" || -f "$PING_BIN" ]] || { echo "hapi-ping-peer not found" >&2; exit 2; }

CLASSIFY_PY="$SCRIPT_DIR/lib/hapi_claude_wake_classify.py"
TMP_JSON="$(mktemp)"
TMP_IDS="$(mktemp)"
# shellcheck disable=SC2064
trap 'rm -f "$TMP_JSON" "$TMP_IDS"' EXIT

MODE="selective"
if [[ -n "$IDS_FILE" ]]; then
    MODE="ids-file"
    grep -vE '^\s*(#|$)' "$IDS_FILE" >"$TMP_IDS" || true
elif [[ "$WAKE_ALL" -eq 1 ]]; then
    MODE="all"
    python3 - "$HAPI_HOST" "$SELF" >"$TMP_IDS" <<'PY'
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
else
    HAPI_HOST="$HAPI_HOST" HAPI_SESSION_ID="$SELF" python3 "$CLASSIFY_PY" >"$TMP_JSON"
    if [[ "$CLASSIFY_ONLY" -eq 1 ]]; then
        cat "$TMP_JSON"
        exit 0
    fi
    python3 - "$TMP_JSON" "$TMP_IDS" <<'PY'
import json, sys
path_json, path_ids = sys.argv[1], sys.argv[2]
d = json.load(open(path_json))
print(
    f"classify wake={d['counts']['wake']} skip={d['counts']['skip']}",
    file=sys.stderr,
)
with open(path_ids, "w") as fh:
    for r in d["wake"]:
        fh.write(r["id"] + "\t" + r["reason"] + "\n")
PY
fi

mapfile -t LINES <"$TMP_IDS"
echo "continue-fleet targets=${#LINES[@]} dry=$DRY mode=$MODE"

ok=0
fail=0
for line in "${LINES[@]+"${LINES[@]}"}"; do
    [[ -z "$line" ]] && continue
    sid="${line%%$'\t'*}"
    reason="${line#*$'\t'}"
    [[ "$reason" == "$sid" ]] && reason="$MODE"
    if [[ "$DRY" -eq 1 ]]; then
        echo "WOULD ping ${sid:0:8} ($reason)"
        ok=$((ok + 1))
        continue
    fi
    if "$PING_BIN" "$sid" "$MSG" >/dev/null 2>&1; then
        echo "OK ${sid:0:8} ($reason)"
        ok=$((ok + 1))
    else
        echo "FAIL ${sid:0:8} ($reason)"
        fail=$((fail + 1))
    fi
    sleep 0.25
done
echo "== continue-fleet ok=$ok fail=$fail =="
exit "$([[ "$fail" -eq 0 ]] && echo 0 || echo 1)"
