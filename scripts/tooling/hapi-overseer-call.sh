#!/usr/bin/env bash
# hapi-overseer-call — thin wrapper for a general agent to call the live
# Overseer HTTP API (/api/overseer/*) without re-deriving the auth dance.
#
# WHAT IT DOES:
#   Exchanges CLI_API_TOKEN for a real {uid,ns} JWT via POST /api/auth (the
#   same exchange `ping_peer` already relies on), then calls the requested
#   overseer route with that JWT as the Bearer token. Prints the raw JSON
#   response to stdout.
#
# WHY IT EXISTS:
#   docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md — a general
#   Claude Code session first assumed there was no credentialed path into
#   /api/overseer/*, based on the raw CLI_API_TOKEN failing as a Bearer token
#   on that route. It fails because it's the wrong token: the hub already
#   exchanges it for a JWT (see hub/src/web/routes/auth.ts), same as the
#   web UI login and `ping_peer` do. This script is that recipe, once, so
#   nobody re-derives or skips it in favour of raw sqlite3 against the
#   production DB.
#
# WHAT IT WILL NEVER DO:
#   Call record_disposition / ping_session directly. Those write tools are
#   gated off on the raw HTTP tool-dispatch route by design (allowWrites is
#   hardcoded false there) — writes only happen through the operator-directed
#   POST /overseer/converse surface (see "Write access" section of the spec
#   doc above). Use `converse` mode below for that, not a raw `tool` call.
#
# Usage:
#   hapi-overseer-call.sh identity
#   hapi-overseer-call.sh tool query_inbox '{"statuses":["new","surfaced"],"limit":10}'
#   hapi-overseer-call.sh tool query_events '{"limit":10}'
#   hapi-overseer-call.sh resolve 'Peer #1593'        # name -> CURRENT session id
#   hapi-overseer-call.sh converse "dismiss the html2canvas oklch item" [relatedSessionId]
#   hapi-overseer-call.sh ntfy "2 new BLOCKED: foo, bar" [priority] [title]
#
# `resolve` exists because **the hub session id is ephemeral**. `cli/src/agent/
# sessionFactory.ts` does `options.tag ?? randomUUID()`, so each CLI launch presents
# a fresh tag; `getOrCreateSession` finds no row for it and mints a new hub id.
# One peer moved 9b23ed0b -> 044295ca -> 0fac9738 in an hour. Stale ids return
# "Session not found", indistinguishable from deletion.
#
# THE DURABLE HANDLE IS `metadata.agentSessionId` (== claudeSessionId for claude
# flavor) — the underlying agent/transcript id. Verified: peer #1593 kept
# agentSessionId 8e1f4fd4 across all three hub-id rotations. Coverage is also
# better than name (502 vs 476 of 611 sessions). Record THAT for anything you need
# to find again later; it survives hub-row churn and resume. It does change if the
# agent is relaunched from scratch (no --resume), so it is durable, not eternal —
# fall back to name, then path.
#
# `resolve <needle>` matches case-insensitively against name, agentSessionId, hub
# id, and path. Output is TSV `hubId<TAB>active|idle<TAB>agentSessionId<TAB>name`,
# best match first (exact field match before substring, then active before idle,
# then most recently updated). Take the first
# line's hubId to act NOW; store its agentSessionId to find it again later.
#
# `ntfy` is the out-of-band proactive channel (Claude Code's own PushNotification
# tool needs "Remote Control" paired to this Anthropic account, which the operator
# doesn't have — it always no-ops). Publishes to a dedicated write-only topic on the
# operator's existing homelab ntfy server (ntfy.introvrtlounge.com/hapi-overseer),
# same pattern as the mapsnatch-publisher / hello-dalle-publisher scoped tokens
# already in server-setup's ntfy registry. Does NOT touch the HAPI hub at all —
# no JWT exchange for this subcommand. Priority: 1(min)-5(max), default 3.
# Operator subscribes on their phone/watch ntfy app to topic `hapi-overseer` on
# server `https://ntfy.introvrtlounge.com` (or tailnet `https://ntfy.tail9944ee.ts.net`).
#
# Env:
#   HAPI_HOST           (default http://127.0.0.1:3006)
#   CLI_API_TOKEN       (required for identity/tool/converse; not needed for ntfy)
#   NTFY_URL            (default https://ntfy.introvrtlounge.com/hapi-overseer)
#   NTFY_TOKEN_FILE     (default ~/.config/hapi/ntfy-overseer-token)

set -euo pipefail

HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"
NTFY_URL="${NTFY_URL:-https://ntfy.introvrtlounge.com/hapi-overseer}"
NTFY_TOKEN_FILE="${NTFY_TOKEN_FILE:-$HOME/.config/hapi/ntfy-overseer-token}"

usage() {
    sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
}

[ $# -ge 1 ] || usage

if [ "$1" = "ntfy" ]; then
    [ $# -ge 2 ] || { echo "error: 'ntfy' requires a message" >&2; usage; }
    MESSAGE="$2"
    PRIORITY="${3:-3}"
    TITLE="${4:-HAPI Overseer}"
    if [ ! -f "$NTFY_TOKEN_FILE" ]; then
        echo "error: ntfy token file not found at $NTFY_TOKEN_FILE" >&2
        exit 1
    fi
    NTFY_TOKEN="$(cat "$NTFY_TOKEN_FILE")"
    curl -sS -X POST "$NTFY_URL" \
        -H "Authorization: Bearer $NTFY_TOKEN" \
        -H "Title: $TITLE" \
        -H "Priority: $PRIORITY" \
        -d "$MESSAGE"
    echo
    exit 0
fi

if [ -z "${CLI_API_TOKEN:-}" ] && command -v jq >/dev/null; then
    SETTINGS_FILE="${HAPI_HOME:-$HOME/.hapi}/settings.json"
    [ -f "$SETTINGS_FILE" ] && CLI_API_TOKEN="$(jq -r '.cliApiToken // empty' "$SETTINGS_FILE" 2>/dev/null || true)"
fi

if [ -z "${CLI_API_TOKEN:-}" ]; then
    echo "error: CLI_API_TOKEN not set and not found in settings.json (cliApiToken)" >&2
    exit 1
fi

mint_token() {
    curl -sS -X POST "$HAPI_HOST/api/auth" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg t "$CLI_API_TOKEN" '{accessToken:$t}')" \
        | jq -r '.token // empty'
}

JWT="$(mint_token)"
if [ -z "$JWT" ]; then
    echo "error: failed to exchange CLI_API_TOKEN for a JWT (check hub is up at $HAPI_HOST)" >&2
    exit 1
fi

case "$1" in
    identity)
        curl -sS "$HAPI_HOST/api/overseer/identity" -H "Authorization: Bearer $JWT"
        ;;
    tool)
        [ $# -ge 2 ] || { echo "error: 'tool' requires a tool name" >&2; usage; }
        TOOL_NAME="$2"
        # NOTE: do NOT use "${3:-{}}" here — bash parses that as ${3:-{} plus a
        # literal }, appending a stray brace to every supplied argument. The hub
        # route swallows malformed JSON as an empty body, so args vanish silently.
        if [ $# -ge 3 ]; then ARGS_JSON="$3"; else ARGS_JSON='{}'; fi
        curl -sS -X POST "$HAPI_HOST/api/overseer/tools/$TOOL_NAME" \
            -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
            -d "$ARGS_JSON"
        ;;
    resolve)
        [ $# -ge 2 ] || { echo "error: 'resolve' requires a name fragment" >&2; usage; }
        [ -n "$2" ] || { echo "error: 'resolve' needle must not be empty" >&2; usage; }
        curl -sS "$HAPI_HOST/api/sessions" -H "Authorization: Bearer $JWT" \
            | jq -r --arg needle "$2" '
                (if type=="array" then . else (.sessions // []) end)
                | map(select(.metadata != null))
                | map(. + { _fields: (
                    [ (.metadata.name // ""), (.metadata.agentSessionId // ""),
                      (.id // ""), (.metadata.path // "") ] | map(ascii_downcase)) })
                | map(select(._fields | map(contains($needle | ascii_downcase)) | any))
                | map(. + { _exact: (._fields | map(. == ($needle | ascii_downcase)) | any) })
                | sort_by([(if ._exact then 0 else 1 end), (if .active then 0 else 1 end), -(.updatedAt // 0)])
                | .[]
                | "\(.id)\t\(if .active then "active" else "idle" end)\t\(.metadata.agentSessionId // "-")\t\(.metadata.name // "?")"
              '
        ;;
    converse)
        [ $# -ge 2 ] || { echo "error: 'converse' requires a message" >&2; usage; }
        MESSAGE="$2"
        RELATED_SESSION="${3:-}"
        BODY="$(jq -nc \
            --arg content "$MESSAGE" \
            --arg rel "$RELATED_SESSION" \
            '{messages: [{role:"operator", content:$content}]} + (if $rel != "" then {relatedSessionId:$rel} else {} end)')"
        curl -sS -X POST "$HAPI_HOST/api/overseer/converse" \
            -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
            -d "$BODY"
        ;;
    *)
        usage
        ;;
esac
echo
