#!/usr/bin/env bash
# hapi-tick-watermark.sh — shared watermark / seen-set helpers for bare pollers.
#
# Strategies (config/ticks.yaml state.strategy):
#   max-id         JSON { "lastMaxId": N } — overseer inbox shape
#   seen-set       one id per line — producer-issue-poll shape
#   timestamp-ids  JSON { "last_seen_timestamp": ms, "last_seen_ids": [...] } — PAT poller shape
#
# Extracted from hapi-overseer-watch-tick.sh + lockhouse pat-mint-alert-poll.sh.
# Source from probe scripts; do not invent new semantics.

# Expand leading ~/ for a given user (default: current $USER / $HOME).
# When install runs under sudo, pass the registry service user so paths land
# under that account's home — not /root.
hapi_tick_expand_path() {
    local p="${1:-}" user="${2:-}" home
    # Trim accidental whitespace
    p="${p#"${p%%[![:space:]]*}"}"
    p="${p%"${p##*[![:space:]]}"}"
    if [[ -n "$user" ]]; then
        home="$(getent passwd "$user" | cut -d: -f6)"
        [[ -n "$home" ]] || home="/home/$user"
    else
        home="${HOME}"
    fi
    case "$p" in
        "~")
            p="$home"
            ;;
        "~/"*)
            p="$home/${p:2}"
            ;;
        \$HOME/*)
            p="$home/${p#\$HOME/}"
            ;;
    esac
    printf '%s\n' "$p"
}

hapi_tick_ensure_parent() {
    local f
    f="$(hapi_tick_expand_path "$1")"
    mkdir -p "$(dirname "$f")"
}

# --- max-id -----------------------------------------------------------------

hapi_tick_max_id_read() {
    local f
    f="$(hapi_tick_expand_path "$1")"
    if [[ ! -f "$f" ]]; then
        echo 0
        return 0
    fi
    jq -r '.lastMaxId // 0' "$f"
}

hapi_tick_max_id_write() {
    local f id
    f="$(hapi_tick_expand_path "$1")"
    id="${2:?id required}"
    hapi_tick_ensure_parent "$f"
    jq -n --argjson id "$id" '{lastMaxId: $id}' > "$f"
}

# Advance watermark to max(current, candidate). Never regresses. Echoes new value.
hapi_tick_max_id_advance() {
    local f candidate current advance
    f="$(hapi_tick_expand_path "$1")"
    candidate="${2:?candidate id required}"
    current="$(hapi_tick_max_id_read "$f")"
    if (( candidate > current )); then
        advance=$candidate
    else
        advance=$current
    fi
    hapi_tick_max_id_write "$f" "$advance"
    printf '%s\n' "$advance"
}

# --- seen-set ---------------------------------------------------------------

hapi_tick_seen_ensure() {
    local f
    f="$(hapi_tick_expand_path "$1")"
    hapi_tick_ensure_parent "$f"
    touch "$f"
}

hapi_tick_seen_has() {
    local f id
    f="$(hapi_tick_expand_path "$1")"
    id="${2:?id required}"
    [[ -f "$f" ]] || return 1
    grep -qx -- "$id" "$f"
}

hapi_tick_seen_add() {
    local f id
    f="$(hapi_tick_expand_path "$1")"
    id="${2:?id required}"
    hapi_tick_seen_ensure "$f"
    if hapi_tick_seen_has "$f" "$id"; then
        return 0
    fi
    printf '%s\n' "$id" >> "$f"
}

# --- timestamp-ids ----------------------------------------------------------

hapi_tick_timestamp_ids_seed() {
    local f ts
    f="$(hapi_tick_expand_path "$1")"
    ts="${2:-0}"
    hapi_tick_ensure_parent "$f"
    jq -n --argjson ts "$ts" '{last_seen_timestamp: $ts, last_seen_ids: []}' > "$f"
}

hapi_tick_timestamp_ids_read() {
    local f
    f="$(hapi_tick_expand_path "$1")"
    if [[ ! -f "$f" ]]; then
        echo '{"last_seen_timestamp":0,"last_seen_ids":[]}'
        return 0
    fi
    jq -c '{last_seen_timestamp: (.last_seen_timestamp // 0), last_seen_ids: (.last_seen_ids // [])}' "$f"
}

hapi_tick_timestamp_ids_write() {
    local f ts ids
    f="$(hapi_tick_expand_path "$1")"
    ts="${2:?timestamp required}"
    ids="${3:?ids json array required}"
    hapi_tick_ensure_parent "$f"
    jq -n --argjson ts "$ts" --argjson ids "$ids" \
        '{last_seen_timestamp: $ts, last_seen_ids: $ids}' > "$f"
}

# Given events JSON array (each with @timestamp + _document_id) and state file,
# print { new_events, new_state } using PAT-poller semantics. Does not write state.
hapi_tick_timestamp_ids_diff() {
    local state_file events_file
    state_file="$(hapi_tick_expand_path "$1")"
    events_file="${2:?events json file required}"
    if [[ ! -f "$state_file" ]]; then
        hapi_tick_timestamp_ids_seed "$state_file" 0
    fi
    jq -n \
        --slurpfile events "$events_file" \
        --slurpfile state "$state_file" \
        '
        ($state[0]) as $st |
        ($events[0] // []) as $all |
        ($all
          | map(select(
              (.["@timestamp"] > $st.last_seen_timestamp)
              or ((.["@timestamp"] == $st.last_seen_timestamp)
                  and ((._document_id as $id | $st.last_seen_ids | index($id)) | not))
            ))
          | sort_by(.["@timestamp"])
        ) as $new |
        ($all | map(.["@timestamp"])) as $all_ts |
        (if ($all_ts | length) > 0 then ($all_ts | max) else $st.last_seen_timestamp end) as $resp_max |
        # Never regress: clamp to at least the stored watermark.
        (if $resp_max > $st.last_seen_timestamp then $resp_max else $st.last_seen_timestamp end) as $max_ts |
        (if $max_ts == $st.last_seen_timestamp and $resp_max <= $st.last_seen_timestamp then
            $st.last_seen_ids
         else
            ($all | map(select(.["@timestamp"] == $max_ts) | ._document_id))
         end) as $ids_at_max |
        {
          new_events: $new,
          new_state: { last_seen_timestamp: $max_ts, last_seen_ids: $ids_at_max }
        }
        '
}
