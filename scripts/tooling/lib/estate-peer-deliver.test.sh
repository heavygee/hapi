#!/usr/bin/env bash
# Unit tests for estate-peer-deliver.sh (timer-attributed ping_peer).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=estate-peer-deliver.sh
source "$LIB/estate-peer-deliver.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
eq() {
    local label="$1" got="$2" want="$3"
    if [[ "$got" == "$want" ]]; then
        ok
    else
        bad "$label (want [$want] got [$got])"
    fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Node/OpenSSL vector: 32×0x01, session 11111111-1111-1111-1111-111111111111
# createHmac('sha256').update('hapi-peer-cap-v1:'+sid).digest('base64url')
WANT_CAP='r0ro4XkomSJ1aRAT8NNYh7KIA67fNny4LOMw-X7ntUg'
SID='11111111-1111-1111-1111-111111111111'
SECRET_B64="$(python3 -c 'import base64; print(base64.b64encode(bytes([1])*32).decode())')"
printf '{"secretBase64":"%s"}\n' "$SECRET_B64" >"$WORK/jwt-secret.json"
export HAPI_JWT_SECRET_FILE="$WORK/jwt-secret.json"

got="$(estate_mint_peer_capability "$SID")" || { bad "mint exit"; got=""; }
eq "hmac vector" "$got" "$WANT_CAP"

# HAPI_HOME wins over ~/.hapi when the explicit file override is unset
unset HAPI_JWT_SECRET_FILE
export HAPI_HOME="$WORK"
got="$(estate_mint_peer_capability "$SID")" || { bad "mint via HAPI_HOME"; got=""; }
eq "hmac via HAPI_HOME" "$got" "$WANT_CAP"
export HAPI_JWT_SECRET_FILE="$WORK/jwt-secret.json"
unset HAPI_HOME

if estate_mint_peer_capability "not-a-uuid" >/dev/null 2>&1; then
    bad "mint accepted non-uuid"
else
    ok
fi

if estate_mint_peer_capability "" >/dev/null 2>&1; then
    bad "mint accepted empty"
else
    ok
fi

export HAPI_JWT_SECRET_FILE="$WORK/missing.json"
if estate_mint_peer_capability "$SID" >/dev/null 2>&1; then
    bad "mint succeeded without secret file"
else
    ok
fi
export HAPI_JWT_SECRET_FILE="$WORK/jwt-secret.json"

# Attributed POST: CLI token + capability header + /cli/sessions/:source/peer-messages
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >"${ESTATE_CURL_LOG}"
# dump headers+body for assertions
i=0
while [[ $i -lt $# ]]; do
    i=$((i+1))
done
printf '%s\n' "$@" >>"${ESTATE_CURL_LOG}.argv"
cat >"${ESTATE_CURL_LOG}.body"  # last -d may be consumed; see wrapper
echo '{"ok":true}'
exit 0
EOF
chmod +x "$WORK/curl"

# More reliable mock: log the whole command line and stdin-equivalent -d payload
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
: >"${ESTATE_CURL_LOG}"
payload=""
prev=""
for a in "$@"; do
    printf '%s\n' "$a" >>"${ESTATE_CURL_LOG}"
    if [[ "$prev" == "-d" ]]; then
        payload="$a"
    fi
    prev="$a"
done
printf '%s' "$payload" >"${ESTATE_CURL_LOG}.body"
echo '{"ok":true}'
exit 0
EOF
chmod +x "$WORK/curl"

export ESTATE_CURL_BIN="$WORK/curl"
export ESTATE_CURL_LOG="$WORK/curl.log"
export HAPI_CLI_API_TOKEN="test-cli-token"
export HAPI_HOST="http://127.0.0.1:3006"

if estate_peer_deliver_attributed "$SID" "22222222-2222-2222-2222-222222222222" "hello from timer"; then
    ok
else
    bad "attributed deliver failed"
fi

if grep -qx "http://127.0.0.1:3006/cli/sessions/${SID}/peer-messages" "$ESTATE_CURL_LOG"; then
    ok
else
    bad "POST url missing"
fi
if grep -qx "x-hapi-session-capability: ${WANT_CAP}" "$ESTATE_CURL_LOG" \
    || grep -qx "X-Hapi-Session-Capability: ${WANT_CAP}" "$ESTATE_CURL_LOG" \
    || grep -q "x-hapi-session-capability: ${WANT_CAP}" "$ESTATE_CURL_LOG"; then
    ok
else
    bad "capability header missing ($(tr '\n' ' ' <"$ESTATE_CURL_LOG"))"
fi
if grep -q "Bearer test-cli-token" "$ESTATE_CURL_LOG"; then
    ok
else
    bad "CLI bearer missing"
fi
if grep -q "22222222-2222-2222-2222-222222222222" "$ESTATE_CURL_LOG.body" \
    && grep -q "hello from timer" "$ESTATE_CURL_LOG.body"; then
    ok
else
    bad "body missing target/text ($(cat "$ESTATE_CURL_LOG.body"))"
fi
# Must NOT use the unattributed web JWT messages path
if grep -q "/api/sessions/.*/messages" "$ESTATE_CURL_LOG"; then
    bad "used unattributed web messages path"
else
    ok
fi

echo "estate-peer-deliver tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
