#!/usr/bin/env bash
# Cursor preToolUse: deny soup remat mutators while remat escalation hold is active.
#
# Matcher: Shell
# Blocks: hapi-driver-rebuild, hapi-driver-build-web, driver_remat_promote,
#         hapi-remat-hold clear (by non-owners — clear goes through CLI owner check;
#         we still deny rebuild/build-web/promote patterns).
#
# Bypass: HAPI_REMAT_OWNER=1 (owner must still match escalate config at script layer)
#         or HAPI_OPERATOR_REMAT_HOLD_CLEAR=1 with tty (operator only).
#
# Install: scripts/tooling/hapi-install-cursor-hooks.sh

set -euo pipefail

# Cursor hooks receive JSON on stdin.
input="$(cat || true)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // .command // empty' 2>/dev/null || true)"

allow() {
    printf '%s\n' '{"permission":"allow"}'
    exit 0
}

deny() {
    local msg="$1"
    jq -n --arg msg "$msg" '{permission:"deny", user_message:$msg}'
    exit 0
}

[[ -n "$command" ]] || allow

# Only care about soup mutation commands.
if ! printf '%s' "$command" | grep -Eq \
    '(^|[[:space:];|&])(hapi-driver-rebuild|hapi-driver-build-web|hapi-driver-rollback-web)\b|driver_remat_promote\b|driver_remat_restore_tip\b'; then
    allow
fi

HOLD_FILE="${HAPI_REMAT_HOLD_FILE:-$HOME/.hapi/remat-hold.json}"
if [[ ! -f "$HOLD_FILE" ]]; then
    allow
fi
if ! command -v jq >/dev/null 2>&1; then
    allow
fi
if [[ "$(jq -r '.active // false' "$HOLD_FILE" 2>/dev/null)" != "true" ]]; then
    allow
fi

# Operator TTY bypass (script layer also gates tty).
if [[ "${HAPI_OPERATOR_REMAT_HOLD_CLEAR:-}" == "1" ]] && [[ -t 0 ]]; then
    allow
fi

# Owner bypass only with matching machine token (not label alone).
if [[ "${HAPI_REMAT_OWNER:-}" == "1" ]]; then
    token_file="${HAPI_REMAT_OWNER_TOKEN_FILE:-$HOME/.config/hapi/remat-owner.token}"
    if [[ -f "$token_file" ]]; then
        expected="$(tr -d '[:space:]' <"$token_file")"
        presented="$(printf '%s' "${HAPI_REMAT_OWNER_TOKEN:-}" | tr -d '[:space:]')"
        if [[ -n "$presented" && "$presented" == "$expected" ]]; then
            allow
        fi
    fi
fi

reason="$(jq -r '.reason // "remat failed"' "$HOLD_FILE" 2>/dev/null || echo remat failed)"
owner="$(jq -r '.owner_session_prefix // "8c6b5a7d"' "$HOLD_FILE" 2>/dev/null || echo 8c6b5a7d)"
deny "REMAT HOLD active ($reason). Do not remat/build-web — escalate to Meta ($owner). Inspect: hapi-remat-hold status. Owner needs HAPI_REMAT_OWNER=1 + HAPI_REMAT_OWNER_TOKEN + matching session/label."
