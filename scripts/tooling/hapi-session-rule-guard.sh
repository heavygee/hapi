#!/usr/bin/env bash
# Cursor preToolUse hook: refuse agent edits to git-tracked hapi-session.mdc.
#
# The headset/chip/TTS identity section lives in .cursor/rules/hapi-session.mdc
# (sentinel <!-- hapi:session-summary-rule -->). HAPI's Cursor launcher also
# writes that path (cursorNotifyRuleOverlay). Agents must not "fix" or shorten
# the file. Ping Meta if you think the contract needs a change.
#
# This hook does NOT catch the CLI overlay (writeFileSync at session start).
# That skip belongs in cursorNotifyRuleOverlay.ts (git-tracked = do not clobber).
#
# Operator-local. Bypass: HAPI_OPERATOR_SESSION_RULE_OVERRIDE=1 with a TTY.

set -uo pipefail

INPUT=$(cat)

TARGET=$(printf '%s' "$INPUT" | jq -r '
    [
      .input.path,
      .tool_input.path,
      .input.target_notebook,
      .tool_input.target_notebook,
      .path
    ]
    | map(select(. != null and . != ""))
    | first // empty
' 2>/dev/null || true)

if [ -z "$TARGET" ]; then
    echo '{ "permission": "allow" }'
    exit 0
fi

if [ "${HAPI_OPERATOR_SESSION_RULE_OVERRIDE:-0}" = "1" ] && [ -t 0 ]; then
    echo '{ "permission": "allow" }'
    exit 0
fi

case "$TARGET" in
    /*) ABS="$TARGET" ;;
    *)  ABS="${PWD}/${TARGET}" ;;
esac
ABS=$(printf '%s' "$ABS" | sed -e 's://*:/:g' -e 's:/\./:/:g')

case "$ABS" in
    */.cursor/rules/hapi-session.mdc) ;;
    *)
        echo '{ "permission": "allow" }'
        exit 0
        ;;
esac

DENY_MSG=$(cat <<'EOF'
STOP. Do not edit .cursor/rules/hapi-session.mdc.

That file is git-tracked headset canon (chip wire format + TTS: no bare session
hashes). HAPI's Cursor launcher (cursor-notify-rule overlay) already tries to
overwrite it with a short stub on every session start. Shortening it is a
kitchen skunk: it dirties the mirror and blocks hapi-sync-fork-main.

What to do:
  1. Stop this edit.
  2. Ping Meta PR watcher: /sessions/9f5f7e1d-d1d8-4d17-a668-0a0fdf4af685
     Say you almost clobbered hapi-session.mdc, cwd, and why.
  3. If the overlay already chopped it: git checkout -- .cursor/rules/hapi-session.mdc

Bypass (operator TTY only): HAPI_OPERATOR_SESSION_RULE_OVERRIDE=1
EOF
)

jq -n \
    --arg msg "$DENY_MSG" \
    --arg abs "$ABS" \
    '{
        permission: "deny",
        agent_message: $msg,
        user_message: ("Blocked: " + $abs + " is tracked headset canon. Ping Meta 9f5f7e1d; do not shorten this rule.")
    }'
exit 0
