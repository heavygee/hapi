#!/usr/bin/env bash
# hapi-overseer-watch-tick — Gap 2 watch-loop, as a bare script (no agent turn).
#
# WHY IT EXISTS:
#   docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md — the first
#   version of this watch-loop was a CronCreate job that re-invoked a Claude
#   Code session every 30 minutes just to run this exact mechanical check.
#   That burns a full LLM turn (prompt read + reasoning + tool calls) for
#   logic that is 100% deterministic: query, diff two numbers, maybe curl.
#   No judgment call here needs an LLM. This script is the same logic under
#   real system cron (see systemd/hapi-overseer-watch.timer) — zero agentic
#   token cost, same as hapi-meta-daily.sh's own pattern.
#
# WHAT IT DOES:
#   Queries the overseer inbox for new/surfaced ERROR/BLOCKED items, diffs
#   against a persisted watermark, and ntfy-alerts only on genuinely new
#   items past the watermark. Watermark only ever advances (max(current,new)),
#   never regresses — an item can drop out of the filtered view after being
#   dispositioned without that meaning it's safe to re-notify on a lower id.
#
# Usage:
#   hapi-overseer-watch-tick.sh
#
# Env:
#   HAPI_HOST, CLI_API_TOKEN / settings.json cliApiToken — see hapi-overseer-call.sh
#   HAPI_OVERSEER_WATCH_STATE (default ${XDG_STATE_HOME:-~/.local/state}/hapi/overseer-watch-watermark.json)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
CALL_BIN="$SCRIPT_DIR/hapi-overseer-call.sh"
WATERMARK_FILE="${HAPI_OVERSEER_WATCH_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi/overseer-watch-watermark.json}"

mkdir -p "$(dirname "$WATERMARK_FILE")"
[ -f "$WATERMARK_FILE" ] || echo '{"lastMaxId": 0}' > "$WATERMARK_FILE"

# NOTE: query_inbox's `category` arg takes a single STRING, not an array, so the
# category filter is applied client-side below rather than server-side. (An array
# here is rejected with "expected string, received array".)
RESULT="$("$CALL_BIN" tool query_inbox '{"statuses":["new","surfaced"],"limit":200}')"
LAST_MAX="$(jq -r '.lastMaxId' "$WATERMARK_FILE")"

WATCHED_CATEGORIES='["ERROR","BLOCKED"]'
NEW_ITEMS="$(echo "$RESULT" | jq --argjson last "$LAST_MAX" --argjson cats "$WATCHED_CATEGORIES" \
    '[.result.items[]? | select(.id > $last) | select(.category as $c | $cats | index($c))]')"
NEW_COUNT="$(echo "$NEW_ITEMS" | jq 'length')"
CURRENT_MAX="$(echo "$RESULT" | jq --argjson cats "$WATCHED_CATEGORIES" \
    '[.result.items[]? | select(.category as $c | $cats | index($c)) | .id] | max // 0')"
ADVANCE_TO=$(( CURRENT_MAX > LAST_MAX ? CURRENT_MAX : LAST_MAX ))

if [ "$NEW_COUNT" -gt 0 ]; then
    SUMMARY="$(echo "$NEW_ITEMS" | jq -r '[.[:2][] | "\(.category): \(.title)"] | join(", ")')"
    MESSAGE="$NEW_COUNT new: $SUMMARY"
    MESSAGE="${MESSAGE:0:200}"
    "$CALL_BIN" ntfy "$MESSAGE" 4 "HAPI Overseer" >/dev/null
    echo "hapi-overseer-watch-tick: alerted on $NEW_COUNT new item(s), watermark $LAST_MAX -> $ADVANCE_TO"
else
    echo "hapi-overseer-watch-tick: nothing new, watermark held at $ADVANCE_TO"
fi

jq -n --argjson id "$ADVANCE_TO" '{lastMaxId: $id}' > "$WATERMARK_FILE"
