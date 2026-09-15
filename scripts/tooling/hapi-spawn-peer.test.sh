#!/usr/bin/env bash
# Verifies hapi-spawn-peer's fail-closed contract against a stub hub:
#   OK only when the peer took the remit AND the agent actually ran.
# Canon: docs/plans/2026-08-11-spawn-peer-empty-shell-postmortem.md, upstream #1752
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRAPPER="$ROOT/scripts/tooling/hapi-spawn-peer.sh"

command -v python3 >/dev/null || { echo "SKIP: python3 required" >&2; exit 0; }
command -v jq >/dev/null || { echo "SKIP: jq required" >&2; exit 0; }

TMP="$(mktemp -d)"
HUB_PID=""
cleanup() {
    [[ -n "$HUB_PID" ]] && kill "$HUB_PID" 2>/dev/null || true
    rm -rf "$TMP"
}
trap cleanup EXIT

cat >"$TMP/stub-hub.py" <<'STUBEOF'
import json, os, time
from http.server import BaseHTTPRequestHandler, HTTPServer

# SCENARIO drives what the stub reports about the spawned session. All of them
# start ACTIVE, because the real hub does: it marks a session active when the
# CLI socket connects, which happens before the agent process is launched.
#   live   - agent takes a turn (thinking) shortly after the remit
#   quiet  - agent never takes a turn but the session stays active
#   dead   - agent dies: session goes inactive, no turn, no second message
#   silent - the remit never lands at all (empty shell)
SCENARIO = os.environ["SCENARIO"]
FLIP_AFTER_S = 3.0
SESSION_ID = "11111111-2222-3333-4444-555555555555"
spawned_at = [None]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _elapsed(self):
        return 0.0 if spawned_at[0] is None else time.time() - spawned_at[0]

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/api/auth":
            self._send({"token": "stub-jwt"})
        elif self.path.endswith("/spawn"):
            spawned_at[0] = time.time()
            self._send({"type": "success", "sessionId": SESSION_ID})
        else:
            self._send({"error": "unexpected " + self.path})

    def do_PATCH(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._send({"ok": True})

    def do_GET(self):
        if "/messages" in self.path:
            count = 0 if SCENARIO == "silent" else 1
            self._send({"messages": [{"id": str(i)} for i in range(count)]})
        elif self.path.startswith("/api/sessions/"):
            late = self._elapsed() >= FLIP_AFTER_S
            active = not (SCENARIO == "dead" and late)
            thinking = SCENARIO == "live" and late
            # Real hub shape: GET /api/sessions/:id returns {session: {...}}.
            self._send({"session": {"id": SESSION_ID, "active": active, "thinking": thinking}})
        else:
            self._send({"error": "unexpected " + self.path})


server = HTTPServer(("127.0.0.1", 0), Handler)
print(server.server_port, flush=True)
server.serve_forever()
STUBEOF

cat >"$TMP/ping-stub.sh" <<'PING'
#!/usr/bin/env bash
cat >/dev/null
echo "ping-stub: delivered to $1"
PING
chmod +x "$TMP/ping-stub.sh"

printf '%s\n' '{"cliApiToken":"stub-token","machineId":"stub-machine"}' >"$TMP/settings.json"
mkdir -p "$TMP/work"

# run_wrapper <scenario> [verify-timeout]
run_wrapper() {
    local scenario="$1"
    : >"$TMP/port"
    SCENARIO="$scenario" python3 "$TMP/stub-hub.py" >"$TMP/port" &
    HUB_PID=$!
    local port=""
    for _ in $(seq 1 50); do
        port="$(head -c 32 "$TMP/port" | tr -d '\n')"
        [[ -n "$port" ]] && break
        sleep 0.1
    done
    [[ -n "$port" ]] || { echo "FAIL: stub hub never reported a port" >&2; exit 1; }

    set +e
    HAPI_HOST="http://127.0.0.1:$port" \
    HAPI_SETTINGS="$TMP/settings.json" \
    HAPI_PING_PEER="$TMP/ping-stub.sh" \
    HAPI_SPAWN_PEER_VERIFY_TIMEOUT_S="${2:-8}" \
        "$WRAPPER" --dir "$TMP/work" --name "stub peer" --session-type simple \
        --message-file - >"$TMP/out" 2>"$TMP/err" </dev/null
    STATUS=$?
    set -e
    kill "$HUB_PID" 2>/dev/null || true
    wait "$HUB_PID" 2>/dev/null || true
    HUB_PID=""
}

expect_status() {
    local label="$1" want="$2"
    if [[ "$STATUS" != "$want" ]]; then
        echo "FAIL $label: expected exit $want, got $STATUS" >&2
        cat "$TMP/err" >&2
        exit 1
    fi
    echo "OK $label (exit $STATUS)"
}

run_wrapper live
expect_status 'agent takes a turn reports OK' 0
grep -q 'hapi-spawn-peer: OK' "$TMP/out" || { echo "FAIL: no OK line for a live peer" >&2; exit 1; }
grep -q 'proof=agent-turn' "$TMP/out" || { echo "FAIL: OK line omits the liveness proof" >&2; exit 1; }

# The regression this test exists for: the remit lands, so the old messages>=1
# check printed OK over a session whose agent never started. Note the session is
# active when spawn returns — as it is for real — and only goes inactive once the
# child dies, which is the signal the wrapper has to wait for.
run_wrapper dead
expect_status 'remit on a dead agent fails closed' 5
grep -q 'went inactive' "$TMP/err" || { echo "FAIL: no liveness diagnosis" >&2; exit 1; }
grep -q 'agent --list-models' "$TMP/err" || { echo "FAIL: no catalog pointer in diagnosis" >&2; exit 1; }
grep -q 'hapi-spawn-peer: OK' "$TMP/out" && { echo "FAIL: printed OK for a dead agent" >&2; exit 1; }

# A peer that stays up without speaking is healthy; it must not be failed.
run_wrapper quiet 6
expect_status 'quiet but still-active peer reports OK' 0
grep -q 'proof=still-active-after-6s' "$TMP/out" || { echo "FAIL: OK line omits the fallback proof" >&2; exit 1; }

run_wrapper silent
expect_status 'undelivered remit fails closed' 4
grep -q 'no messages' "$TMP/err" || { echo "FAIL: no empty-shell diagnosis" >&2; exit 1; }

# A non-numeric timeout must be rejected up front, not blow up under set -e
# after the remit has already been delivered.
run_wrapper live 60s
expect_status 'non-numeric verify timeout is a usage error' 2
grep -q 'whole number of seconds' "$TMP/err" || { echo "FAIL: no timeout usage diagnosis" >&2; exit 1; }

echo "hapi-spawn-peer.test.sh: all patterns OK"
