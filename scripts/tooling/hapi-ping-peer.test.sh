#!/usr/bin/env bash
# hapi-ping-peer estate attribution (HAPI_ESTATE_PEER_ATTRIBUTE=1).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/hapi-ping-peer.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SID='11111111-1111-1111-1111-111111111111'
TARGET='22222222-2222-2222-2222-222222222222'
WANT_CAP='r0ro4XkomSJ1aRAT8NNYh7KIA67fNny4LOMw-X7ntUg'
SECRET_B64="$(python3 -c 'import base64; print(base64.b64encode(bytes([1])*32).decode())')"
printf '{"secretBase64":"%s"}\n' "$SECRET_B64" >"$WORK/jwt-secret.json"
printf '{"cliApiToken":"test-cli-token"}\n' >"$WORK/settings.json"

cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
log="${ESTATE_CURL_LOG}"
printf 'ARG %s\n' "$@" >>"$log"
# JWT exchange
if [[ "$*" == *"/api/auth"* ]]; then
    echo '{"token":"JWT"}'; exit 0
fi
# session list / get
if [[ "$*" == *"/api/sessions?limit=500"* ]]; then
    cat <<'JSON'
{"sessions":[
 {"id":"22222222-2222-2222-2222-222222222222","active":true,"metadata":{"name":"target","flavor":"claude"}}
]}
JSON
    exit 0
fi
if [[ "$*" == *"/api/sessions/22222222-2222-2222-2222-222222222222"* ]]; then
    echo '{"session":{"id":"22222222-2222-2222-2222-222222222222","active":true,"metadata":{"name":"target","flavor":"claude"}}}'
    exit 0
fi
if [[ "$*" == *"/cli/sessions/"* && "$*" == *"/peer-messages"* ]]; then
    echo '{"ok":true}'; exit 0
fi
if [[ "$*" == *"/api/sessions/"* && "$*" == *"/messages"* ]]; then
    echo '{"ok":true}'; exit 0
fi
echo '{"ok":false}' >&2
exit 1
EOF
chmod +x "$WORK/curl"

# PATH: our curl first; no soup `hapi` (FORCE_BASH)
export PATH="$WORK:$PATH"
export HAPI_PING_PEER_FORCE_BASH=1
export HAPI_ESTATE_PEER_ATTRIBUTE=1
export HAPI_SESSION_ID="$SID"
export HAPI_SESSION_NAME="meta - PR watcher"
export HAPI_SETTINGS="$WORK/settings.json"
export HAPI_JWT_SECRET_FILE="$WORK/jwt-secret.json"
export HAPI_HOST="http://127.0.0.1:3006"
export ESTATE_CURL_LOG="$WORK/curl.log"
: >"$ESTATE_CURL_LOG"

# curl is invoked as `curl` from the script, not ESTATE_CURL_BIN — wrap via PATH
if ! out="$("$SCRIPT" "$TARGET" "hourly ping" 2>&1)"; then
    bad "ping-peer attributed run failed: $out"
else
    ok
fi

if grep -q "/cli/sessions/${SID}/peer-messages" "$ESTATE_CURL_LOG"; then
    ok
else
    bad "did not POST attributed peer-messages ($(cat "$ESTATE_CURL_LOG"))"
fi
if grep -q "x-hapi-session-capability: ${WANT_CAP}" "$ESTATE_CURL_LOG"; then
    ok
else
    bad "missing capability header"
fi
if grep -q "/api/sessions/.*/messages" "$ESTATE_CURL_LOG"; then
    bad "also posted unattributed web messages"
else
    ok
fi
# Attributed path must not prepend From: (verified chip keeps that text)
if printf '%s' "$out" | grep -q "stamped From:"; then
    bad "stamped From: on attributed send"
else
    ok
fi

echo "hapi-ping-peer estate tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
