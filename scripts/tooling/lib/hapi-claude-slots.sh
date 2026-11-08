# lib/hapi-claude-slots.sh — shared Claude dual-slot helpers (source only).
# Slots live under ~/.hapi/claude-auth/{primary,secondary}/.
# shellcheck shell=bash

HAPI_CLAUDE_AUTH_ROOT="${HAPI_CLAUDE_AUTH_ROOT:-$HOME/.hapi/claude-auth}"
HAPI_PROXMOX_SSH="${HAPI_PROXMOX_SSH:-heavygee@192.168.86.73}"
HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"

hapi_claude_slot_token_file() {
    local slot="$1"
    printf '%s\n' "$HAPI_CLAUDE_AUTH_ROOT/$slot/claude-setup-token.env"
}

hapi_claude_active_slot() {
    local f="$HAPI_CLAUDE_AUTH_ROOT/active"
    [[ -f "$f" ]] || { echo ""; return 1; }
    tr -d '[:space:]' <"$f"
}

hapi_claude_read_token() {
    # stdout: token value only. rc 0 ok, 1 missing/empty.
    local file="$1" line val
    [[ -f "$file" && ! -L "$file" ]] || return 1
    line="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$file" | tail -n1 || true)"
    [[ -n "$line" ]] || return 1
    val="${line#CLAUDE_CODE_OAUTH_TOKEN=}"
    val="${val#$'\r'}"
    [[ -n "$val" ]] || return 1
    printf '%s' "$val"
}

hapi_claude_sha12() {
    printf '%s' "$1" | sha256sum | cut -c1-12
}

hapi_claude_slot_sha12() {
    local slot="$1" tok
    tok="$(hapi_claude_read_token "$(hapi_claude_slot_token_file "$slot")")" || return 1
    hapi_claude_sha12 "$tok"
}

# Smoke a slot's setup-token via isolated CLAUDE_CONFIG_DIR.
# Prints one line: STATUS|detail  where STATUS is ok|capped|auth|error
# Optional 2nd arg: timeout seconds (default 35).
hapi_claude_smoke_slot() {
    local slot="$1"
    local timeout_s="${2:-35}"
    local tok cfg out rc=0
    tok="$(hapi_claude_read_token "$(hapi_claude_slot_token_file "$slot")")" || {
        echo "error|missing token file for $slot"
        return 2
    }
    cfg="$(mktemp -d "/tmp/hapi-claude-smoke-${slot}.XXXXXX")"
    # shellcheck disable=SC2064
    trap "rm -rf '$cfg'" RETURN
    set +e
    out="$(
        CLAUDE_CODE_OAUTH_TOKEN="$tok" \
        CLAUDE_CONFIG_DIR="$cfg" \
        env -u CLAUDE_CODE_OAUTH_REFRESH_TOKEN \
        timeout "$timeout_s" claude -p --output-format text "reply exactly: ${slot}-ok" 2>&1
    )"
    rc=$?
    set -e
    if grep -qiE 'session limit|rate limit|usage limit|resets [0-9]' <<<"$out"; then
        # Prefer the resets fragment when present.
        local detail
        detail="$(grep -oiE 'resets[^[:cntrl:]]*' <<<"$out" | head -1 | tr -s '[:space:]' ' ' | sed 's/[[:space:]]*$//')"
        [[ -n "$detail" ]] || detail="$(echo "$out" | tr '\n' ' ' | tr -s ' ' | cut -c1-120)"
        echo "capped|$detail"
        return 1
    fi
    if grep -qiE 'not logged in|please run /login|authentication|unauthorized' <<<"$out"; then
        echo "auth|$(echo "$out" | tr '\n' ' ' | tr -s ' ' | cut -c1-120)"
        return 2
    fi
    if [[ "$rc" -eq 0 ]] && grep -q "${slot}-ok" <<<"$out"; then
        echo "ok|${slot}-ok"
        return 0
    fi
    if [[ "$rc" -eq 124 ]]; then
        echo "error|timeout after ${timeout_s}s"
        return 2
    fi
    echo "error|$(echo "$out" | tr '\n' ' ' | tr -s ' ' | cut -c1-120)"
    return 2
}

hapi_claude_hub_jwt() {
    local settings="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
    python3 - "$settings" "$HAPI_HOST" <<'PY'
import json, sys, urllib.request
settings, host = sys.argv[1], sys.argv[2]
tok = json.load(open(settings))["cliApiToken"]
req = urllib.request.Request(
    host + "/api/auth",
    data=json.dumps({"accessToken": tok + ":default"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
print(json.loads(urllib.request.urlopen(req, timeout=15).read())["token"])
PY
}
