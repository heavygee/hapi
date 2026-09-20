#!/usr/bin/env bash
# Unit tests for hapi-tick-watermark.sh
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=hapi-tick-watermark.sh
source "$DIR/hapi-tick-watermark.sh"

PASS=0
FAIL=0
check() {
    local name="$1"
    shift
    if eval "$*"; then
        echo "PASS $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL $name" >&2
        FAIL=$((FAIL + 1))
    fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check expand_tilde '[[ "$(hapi_tick_expand_path "~/.cache/x")" == "$HOME/.cache/x" ]]'

f="$TMP/max.json"
hapi_tick_max_id_write "$f" 10
check max_id_read '[[ "$(hapi_tick_max_id_read "$f")" == "10" ]]'
check max_id_advance '[[ "$(hapi_tick_max_id_advance "$f" 42)" == "42" ]]'
check max_id_no_regress '[[ "$(hapi_tick_max_id_advance "$f" 7)" == "42" ]]'

s="$TMP/seen.txt"
hapi_tick_seen_add "$s" "12"
hapi_tick_seen_add "$s" "12"
check seen_has 'hapi_tick_seen_has "$s" "12"'
check seen_missing '! hapi_tick_seen_has "$s" "99"'
check seen_unique '[[ "$(wc -l < "$s" | tr -d " ")" == "1" ]]'

t="$TMP/ts.json"
# Seed at 1000 with id "a" already seen — only b,c at 2000 are new.
hapi_tick_timestamp_ids_write "$t" 1000 '["a"]'
events="$TMP/events.json"
cat > "$events" <<'JSON'
[
  {"@timestamp": 1000, "_document_id": "a"},
  {"@timestamp": 2000, "_document_id": "b"},
  {"@timestamp": 2000, "_document_id": "c"}
]
JSON
diff_out="$(hapi_tick_timestamp_ids_diff "$t" "$events")"
new_count="$(printf '%s' "$diff_out" | jq '.new_events | length')"
check ts_new_count '[[ "$new_count" == "2" ]]'
new_state="$(printf '%s' "$diff_out" | jq -c '.new_state')"
hapi_tick_timestamp_ids_write "$t" "$(printf '%s' "$new_state" | jq '.last_seen_timestamp')" "$(printf '%s' "$new_state" | jq -c '.last_seen_ids')"
diff2="$(hapi_tick_timestamp_ids_diff "$t" "$events")"
new_count2="$(printf '%s' "$diff2" | jq '.new_events | length')"
check ts_idempotent '[[ "$new_count2" == "0" ]]'


# Expand for a named user (not current HOME) — sudo-install safety.
check expand_for_user '[[ "$(hapi_tick_expand_path "~/.cache/x" "heavygee")" == "/home/heavygee/.cache/x" ]]'

# Older-only response must not regress stored timestamp/ids.
t2="$TMP/ts2.json"
hapi_tick_timestamp_ids_write "$t2" 5000 '["keep"]'
events_old="$TMP/events_old.json"
cat > "$events_old" <<'JSON'
[
  {"@timestamp": 1000, "_document_id": "old1"},
  {"@timestamp": 2000, "_document_id": "old2"}
]
JSON
diff_old="$(hapi_tick_timestamp_ids_diff "$t2" "$events_old")"
check ts_no_regress_ts '[[ "$(printf "%s" "$diff_old" | jq ".new_state.last_seen_timestamp")" == "5000" ]]'
check ts_no_regress_ids '[[ "$(printf "%s" "$diff_old" | jq -c ".new_state.last_seen_ids")" == "[\"keep\"]" ]]'
check ts_no_new_when_older '[[ "$(printf "%s" "$diff_old" | jq ".new_events | length")" == "0" ]]'


# Same timestamp, previously unseen id → new_events + merged last_seen_ids
t3="$TMP/ts3.json"
hapi_tick_timestamp_ids_write "$t3" 2000 '["b"]'
events_same="$TMP/events_same.json"
cat > "$events_same" <<'JSON'
[
  {"@timestamp": 2000, "_document_id": "b"},
  {"@timestamp": 2000, "_document_id": "c"}
]
JSON
diff_same="$(hapi_tick_timestamp_ids_diff "$t3" "$events_same")"
check ts_merge_same_ts_new '[[ "$(printf "%s" "$diff_same" | jq ".new_events | length")" == "1" ]]'
check ts_merge_same_ts_ids '[[ "$(printf "%s" "$diff_same" | jq -c ".new_state.last_seen_ids | sort")" == "[\"b\",\"c\"]" ]]'

echo "hapi-tick-watermark.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
