#!/usr/bin/env bash
# Timer-attributed peer delivery (fork-local).
#
# #1203 / PR #1473 stamps meta.peer.sourceSessionId only when the caller
# presents a hub HMAC session capability. Wrapped agents get that from the
# parent broker (descendant peercred). systemd timers are not descendants,
# so they would otherwise POST the unattributed web path and the UI shows
# "unknown peer".
#
# This helper mints the same HMAC the hub uses (jwt-secret.json) and POSTs
# /cli/sessions/:source/peer-messages. It is for machine timers that already
# run as the hub user — NOT for agents. Agents: use MCP ping_peer / the
# parent broker. Do not copy this mint into skills or ping_peer wrappers.
#
# Gate: callers must set HAPI_ESTATE_PEER_ATTRIBUTE=1 and a full-UUID
# HAPI_SESSION_ID (the principal to appear on the chip).
#
# shellcheck shell=bash

estate_jwt_secret_file() {
    if [[ -n "${HAPI_JWT_SECRET_FILE:-}" ]]; then
        printf '%s' "$HAPI_JWT_SECRET_FILE"
        return 0
    fi
    if [[ -n "${HAPI_HOME:-}" ]]; then
        printf '%s' "$HAPI_HOME/jwt-secret.json"
        return 0
    fi
    # oos hub unit uses HAPI_HOME=/var/lib/hapi; ~/.hapi is a different secret.
    if [[ -f /var/lib/hapi/jwt-secret.json ]]; then
        printf '%s' /var/lib/hapi/jwt-secret.json
        return 0
    fi
    printf '%s' "$HOME/.hapi/jwt-secret.json"
}

# estate_mint_peer_capability <session-uuid>  → prints base64url HMAC
estate_mint_peer_capability() {
    local sid="${1:-}"
    local secret_file
    secret_file="$(estate_jwt_secret_file)"
    if [[ ! "$sid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        echo "estate-peer-deliver: source session must be a full UUID" >&2
        return 1
    fi
    if [[ ! -f "$secret_file" ]]; then
        echo "estate-peer-deliver: jwt secret file missing: $secret_file" >&2
        return 1
    fi
    python3 - "$secret_file" "$sid" <<'PY'
import base64, hashlib, hmac, json, sys
path, sid = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    raw = json.load(fh)
secret_b64 = raw.get("secretBase64")
if not isinstance(secret_b64, str) or not secret_b64.strip():
    raise SystemExit("jwt-secret.json missing secretBase64")
secret = base64.b64decode(secret_b64)
if len(secret) != 32:
    raise SystemExit(f"jwt secret length {len(secret)} != 32")
digest = hmac.new(secret, f"hapi-peer-cap-v1:{sid}".encode(), hashlib.sha256).digest()
print(base64.urlsafe_b64encode(digest).rstrip(b"=").decode())
PY
}

estate_cli_token() {
    if [[ -n "${HAPI_CLI_API_TOKEN:-}" ]]; then
        printf '%s' "$HAPI_CLI_API_TOKEN"
        return 0
    fi
    local settings="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
    if [[ ! -f "$settings" ]]; then
        echo "estate-peer-deliver: settings not found: $settings" >&2
        return 1
    fi
    local tok
    tok="$(jq -r '.cliApiToken // empty' "$settings")"
    if [[ -z "$tok" ]]; then
        echo "estate-peer-deliver: no cliApiToken in $settings" >&2
        return 1
    fi
    printf '%s' "$tok"
}

# estate_peer_deliver_attributed <source-uuid> <target-uuid> <message>
estate_peer_deliver_attributed() {
    local source_id="$1" target_id="$2" message="$3"
    local host cap token curl_bin body
    host="${HAPI_HOST:-http://127.0.0.1:3006}"
    curl_bin="${ESTATE_CURL_BIN:-${HAPI_META_CURL_BIN:-curl}}"
    cap="$(estate_mint_peer_capability "$source_id")" || return 1
    token="$(estate_cli_token)" || return 1
    if [[ ! "$target_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        echo "estate-peer-deliver: target session must be a full UUID" >&2
        return 1
    fi
    if [[ -z "$message" ]]; then
        echo "estate-peer-deliver: empty message" >&2
        return 1
    fi
    body="$(jq -cn --arg t "$target_id" --arg m "$message" '{targetSessionId:$t, text:$m}')"
    local resp
    resp="$("$curl_bin" -sS --max-time 30 -X POST \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -H "x-hapi-session-capability: ${cap}" \
        -d "$body" \
        "${host}/cli/sessions/${source_id}/peer-messages")" || {
        echo "estate-peer-deliver: POST failed (transport)" >&2
        return 1
    }
    if printf '%s' "$resp" | jq -e '.ok == true' >/dev/null 2>&1; then
        return 0
    fi
    echo "estate-peer-deliver: send rejected: $resp" >&2
    return 1
}
