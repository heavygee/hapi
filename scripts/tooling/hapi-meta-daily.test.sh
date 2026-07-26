#!/usr/bin/env bash
# Integration test for hapi-meta-daily using mock gh / curl / batch / ping.
# Proves: discovery union, dry-run purity, state-gated ping dedupe (2nd run
# no-op), inactive handling, orphan detection, notification cursor advance.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/hapi-meta-daily.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }
check(){ if eval "$2"; then ok; else bad "$1"; fi; }

# --- mock gh --------------------------------------------------------------
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '100\n200\n400\n999\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    printf '300\tfix: shipped thing\t2026-07-24T02:52:06Z\n'; exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    # one upstream comms item; fork repo → none. Honor since= (ISO compare).
    if [[ "$args" == *"tiann/hapi/notifications"* ]]; then
        notif_ts="2026-07-25T08:00:00Z"
        since=""
        if [[ "$args" =~ since=([^[:space:]\&\"\']+) ]]; then
            since="${BASH_REMATCH[1]}"
        fi
        if [[ -z "$since" || "$notif_ts" > "$since" ]]; then
            printf '%s\tPullRequest\tcomment\tRe: PR #100 please rebase\thttps://x\n' "$notif_ts"
        fi
    fi
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"

# --- mock batch (classifier) ---------------------------------------------
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
# emit fixed classification for whatever PR numbers are passed
j='{}'
for a in "$@"; do
    case "$a" in
        100) j="$(echo "$j" | jq -c '. + {"100":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false,dataUnavailable:false}}')" ;;
        200) j="$(echo "$j" | jq -c '. + {"200":{emoji:"✅",action:"full green — wait on tiann",prePr:false,merged:false}}')" ;;
        300) j="$(echo "$j" | jq -c '. + {"300":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
        400) j="$(echo "$j" | jq -c '. + {"400":{emoji:"⚠️",action:"fix failing CI",prePr:false,merged:false}}')" ;;
        999) j="$(echo "$j" | jq -c '. + {"999":{emoji:"⚠️",action:"push to trigger bot review",prePr:false,merged:false}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"

# --- mock curl (hub) ------------------------------------------------------
# auth → token; sessions → 4 PR-tagged sessions; PATCH → ok
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

# --- mock ping (records who got pinged) -----------------------------------
cat >"$WORK/ping" <<EOF
#!/usr/bin/env bash
echo "\$1" >> "$WORK/pings.log"
exit 0
EOF
chmod +x "$WORK/ping"

echo '{"cliApiToken":"tok"}' >"$WORK/settings.json"

run() {
    rm -f "$WORK/pings.log"
    HAPI_META_GH_BIN="$WORK/gh" \
    HAPI_META_CURL_BIN="$WORK/curl" \
    HAPI_META_BATCH_BIN="$WORK/batch" \
    HAPI_META_PING_BIN="$WORK/ping" \
    HAPI_META_STATE="$WORK/state.json" \
    HAPI_SETTINGS="$WORK/settings.json" \
    HAPI_HOST="http://mock" \
    bash "$SCRIPT" "$@"
}

# ============ 1. dry-run writes no state ============
rm -f "$WORK/state.json"
out="$(run --dry-run 2>&1)"
check "dry-run: no state file written" "[[ ! -f '$WORK/state.json' ]]"
check "dry-run: reports warn #100" "grep -q 'NEEDS WORK' <<<\"\$out\""
check "dry-run: reports merged #300" "grep -q 'MERGED' <<<\"\$out\""
check "dry-run: orphan #999 surfaced" "grep -q '#999' <<<\"\$out\""
check "dry-run: inactive #400 surfaced" "grep -qi 'INACTIVE' <<<\"\$out\""
check "dry-run: new comms surfaced" "grep -q 'NEW GITHUB COMMS' <<<\"\$out\""

# ============ 2. first real run: pings fire, state written ============
rm -f "$WORK/state.json"
out="$(run 2>&1)"
pings="$(sort "$WORK/pings.log" 2>/dev/null || true)"
check "run1: state written" "[[ -f '$WORK/state.json' ]]"
check "run1: pinged #100 warn (aaaaaaaa)" "grep -q '^aaaaaaaa' <<<\"\$pings\""
check "run1: pinged #300 merged (cccccccc)" "grep -q '^cccccccc' <<<\"\$pings\""
check "run1: ✅ #200 first-sight transition pings (bbbbbbbb)" "grep -q '^bbbbbbbb' <<<\"\$pings\""
check "run1: #400 asleep NOT pinged" "! grep -q '^dddddddd' <<<\"\$pings\""

# ============ 3. second run same inputs: idempotent (no pings) ============
out="$(run 2>&1)"
pings2="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "run2: NO pings (state-gated dedupe)" "[[ -z \"\$pings2\" ]]"
check "run2: still lists warn #100 in queue" "grep -q '#100' <<<\"\$out\""

# ============ 4. reminder elapsed → sticky warn re-pings ============
# rewind last_ping far into the past for the warn session, keep fp
tmp="$(jq -c '(.sessions["aaaaaaaa-1111"].last_ping) = 1' "$WORK/state.json")"
echo "$tmp" >"$WORK/state.json"
out="$(run --reminder-hours 1 2>&1)"
pings3="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "run3: reminder elapsed → #100 re-pinged" "grep -q '^aaaaaaaa' <<<\"\$pings3\""
check "run3: ✅ #200 still silent" "! grep -q '^bbbbbbbb' <<<\"\$pings3\""

# ============ 5. --no-ping never pings ============
out="$(run --no-ping 2>&1)"
pings4="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "run4: --no-ping sends nothing" "[[ -z \"\$pings4\" ]]"

# ============ 6. notification cursor advances ============
c="$(jq -r '.notif_cursor["tiann/hapi"]' "$WORK/state.json")"
check "notif cursor advanced (non-null)" "[[ -n \"\$c\" && \"\$c\" != null ]]"

# ============ 7. --emit-events default OFF → zero POSTs ============
rm -f "$WORK/state.json" "$WORK/events.log"
# enhance curl mock to log system-events POSTs
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    echo "\$args" >> "$WORK/events.log"
    echo '{"event":{"id":1},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run 2>&1)"
check "default: zero system-events POSTs" "[[ ! -f '$WORK/events.log' ]]"
check "default: still pings warn #100" "grep -q '^aaaaaaaa' '$WORK/pings.log'"

# ============ 8. --emit-events first run → POSTs for transitions ============
rm -f "$WORK/state.json" "$WORK/events.log" "$WORK/pings.log"
out="$(run --emit-events 2>&1)"
evcount="$(wc -l <"$WORK/events.log" 2>/dev/null || echo 0)"
check "emit: at least one POST" "[[ \$evcount -ge 1 ]]"
check "emit: ✅ #200 transition POSTed" "grep -q 'bbbbbbbb-2222' '$WORK/events.log' || grep -q 'progress' '$WORK/events.log'"

# capture bodies for inspection: rebuild curl to dump -d payload
# (events.log currently has args; ensure attentionCandidate present in a dry body path)

# ============ 9. second --emit-events run same state → zero POSTs ============
rm -f "$WORK/events.log"
out="$(run --emit-events 2>&1)"
check "emit run2: zero POSTs (steady)" "[[ ! -f '$WORK/events.log' ]]"

# ============ 10. --dry-run --emit-events prints bodies, zero HTTP POSTs ============
rm -f "$WORK/state.json" "$WORK/events.log"
out="$(run --dry-run --emit-events 2>&1)"
check "dry+emit: no state written" "[[ ! -f '$WORK/state.json' ]]"
check "dry+emit: zero system-events POSTs" "[[ ! -f '$WORK/events.log' ]]"
check "dry+emit: prints channel body" "grep -q '\"sourceKind\": \"channel\"\\|\"sourceKind\":\"channel\"' <<<\"\$out\""

# ============ 11. reminder emit keys include :reminder:YYYY-MM-DD ============
rm -f "$WORK/state.json" "$WORK/events.log"
out="$(run --emit-events 2>&1)"  # establish state
tmp="$(jq -c '
  .sessions["aaaaaaaa-1111"].last_ping = 1
  | .sessions["aaaaaaaa-1111"].last_emitted = 1
  | .sessions["aaaaaaaa-1111"].emitted_emoji = .sessions["aaaaaaaa-1111"].emoji
  | .sessions["aaaaaaaa-1111"].emitted_fp = .sessions["aaaaaaaa-1111"].fp
' "$WORK/state.json")"
echo "$tmp" >"$WORK/state.json"
rm -f "$WORK/events.log"
# curl must capture POST body for key inspection
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    # last non-flag arg after -d is the JSON body in our invocations
    body=""
    prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then body="\$a"; fi
        prev="\$a"
    done
    echo "\$body" >> "$WORK/events.log"
    echo '{"event":{"id":9},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --emit-events --reminder-hours 1 2>&1)"
check "reminder emit: body has reminder suffix in idempotencyKey" \
    "grep -q ':reminder:' '$WORK/events.log'"
check "reminder emit: dedupeKey also has reminder suffix" \
    "jq -e 'select(.dedupeKey|test(\":reminder:\"))' <'$WORK/events.log' >/dev/null"

# ============ 12. POST 500 does not consume emit cursor; retry on next healthy run ============
rm -f "$WORK/state.json" "$WORK/events.log" "$WORK/pings.log"
# Fail all system-events POSTs
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    echo "\$args" >> "$WORK/events.log"
    echo '{"error":"boom"}'
    # Prefer writing status via file the harness can see; curl mock returns body only.
    # Real hub_emit_event must treat missing event.id / non-2xx as failure.
    exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

set +e
out="$(run --emit-events 2>&1)"
rc=$?
set -e
check "emit 500: script exits nonzero" "[[ \$rc -ne 0 ]]"
check "emit 500: warn still pinged (actuator independent)" "grep -q '^aaaaaaaa' '$WORK/pings.log'"
# Emit cursor must remain empty so retry is possible
emitted="$(jq -r '.sessions["aaaaaaaa-1111"].emitted_fp // empty' "$WORK/state.json" 2>/dev/null || true)"
check "emit 500: emitted_fp not consumed" "[[ -z \"\$emitted\" ]]"
notif_seen_count="$(jq '(.notif_seen // {}) | length' "$WORK/state.json" 2>/dev/null || echo 0)"
check "emit 500: notif_seen not consumed" "[[ \"\$notif_seen_count\" -eq 0 ]]"

# Heal curl → next run emits once (at least for session transitions still pending)
rm -f "$WORK/events.log"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    body=""; prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then body="\$a"; fi
        prev="\$a"
    done
    echo "\$body" >> "$WORK/events.log"
    echo '{"event":{"id":42},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --emit-events 2>&1)"
ev_retry="$(wc -l <"$WORK/events.log" 2>/dev/null || echo 0)"
check "emit retry: healthy run POSTs pending events" "[[ \$ev_retry -ge 1 ]]"
emitted2="$(jq -r '.sessions["aaaaaaaa-1111"].emitted_fp // empty' "$WORK/state.json")"
check "emit retry: emitted_fp recorded after 2xx" "[[ -n \"\$emitted2\" ]]"

# ============ 13. failed notif emit must NOT advance notif_cursor (since-aware) ============
rm -f "$WORK/state.json" "$WORK/events.log" "$WORK/pings.log"
# Fail only system-events (incl. notif emits); gh mock already honors since=
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    body=""; prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then body="\$a"; fi
        prev="\$a"
    done
    echo "\$body" >> "$WORK/events.log"
    echo '{"error":"notif boom"}'
    exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

set +e
out="$(run --emit-events 2>&1)"
rc=$?
set -e
check "notif cursor freeze: exit nonzero on emit fail" "[[ \$rc -ne 0 ]]"
c_fail="$(jq -r '.notif_cursor["tiann/hapi"] // empty' "$WORK/state.json")"
# Must remain at-or-before the notif timestamp so a since= query still returns it.
check "notif cursor freeze: cursor not past failed notif" \
    "[[ -n \"\$c_fail\" && ! \"\$c_fail\" > \"2026-07-25T08:00:00Z\" ]]"

# Heal → next run must still see the notif (since-aware) and emit it once
rm -f "$WORK/events.log"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    body=""; prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then body="\$a"; fi
        prev="\$a"
    done
    echo "\$body" >> "$WORK/events.log"
    echo '{"event":{"id":77},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work"}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"PR #300: merged thing"}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"PR #400: asleep warn"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --emit-events 2>&1)"
check "notif cursor freeze: retry emits notif once" \
    "grep -q 'GitHub PullRequest/comment: Re: PR #100 please rebase' '$WORK/events.log'"
c_ok="$(jq -r '.notif_cursor["tiann/hapi"] // empty' "$WORK/state.json")"
check "notif cursor freeze: cursor advances after successful notif emit" \
    "[[ -n \"\$c_ok\" && \"\$c_ok\" > \"2026-07-25T08:00:00Z\" ]]"
# Third run: since past notif → zero notif POSTs for that subject
rm -f "$WORK/events.log"
out="$(run --emit-events 2>&1)"
check "notif cursor freeze: steady run does not re-fetch failed-then-emitted notif" \
    "[[ ! -f '$WORK/events.log' ]] || ! grep -q 'GitHub PullRequest/comment: Re: PR #100 please rebase' '$WORK/events.log'"

# ============ 14. two sessions tracking one PR → two distinct-key POSTs ======
# Meta live dry-run: PR #200 tracked by two sessions produced identical
# idempotency/dedupe keys, so the hub deduped the second and only one inbox
# item got the transition. Session-bound keys must carry a session component.
rm -f "$WORK/state.json" "$WORK/events.log" "$WORK/pings.log"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    body=""; prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then body="\$a"; fi
        prev="\$a"
    done
    echo "\$body" >> "$WORK/events.log"
    echo '{"event":{"id":200},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"3c141438-aaaa","active":true,"metadata":{"name":"PR #200: green thing"}},
 {"id":"136df8b7-bbbb","active":true,"metadata":{"name":"PR #200: green thing too"}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

# gh returns no open PRs / notifs for this scenario (keep it session-only)
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* ]]; then exit 0; fi
exit 0
EOF
chmod +x "$WORK/gh"

out="$(run --emit-events 2>&1)"
ev_lines="$(wc -l <"$WORK/events.log" 2>/dev/null || echo 0)"
check "two-session: two POSTs (one per session)" "[[ \$ev_lines -eq 2 ]]"
k1="$(jq -r '.idempotencyKey' <"$WORK/events.log" | sed -n 1p)"
k2="$(jq -r '.idempotencyKey' <"$WORK/events.log" | sed -n 2p)"
check "two-session: idempotencyKeys differ" "[[ \"\$k1\" != \"\$k2\" && -n \"\$k1\" && -n \"\$k2\" ]]"
check "two-session: both keys carry :sess:" \
    "jq -r '.idempotencyKey' <'$WORK/events.log' | grep -qc ':sess:' && [[ \$(jq -r '.idempotencyKey' <'$WORK/events.log' | grep -c ':sess:') -eq 2 ]]"
d1="$(jq -r '.dedupeKey' <"$WORK/events.log" | sed -n 1p)"
d2="$(jq -r '.dedupeKey' <"$WORK/events.log" | sed -n 2p)"
check "two-session: dedupeKeys differ" "[[ \"\$d1\" != \"\$d2\" ]]"

# ============ 12. --backfill-refs dry plan + --apply PUT ============
rm -f "$WORK/state.json" "$WORK/put-refs.log"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"repos/tiann/hapi/pulls/100"* ]]; then
    echo '{"html_url":"https://github.com/tiann/hapi/pull/100"}'; exit 0
fi
if [[ "$args" == *"repos/tiann/hapi/pulls/200"* ]]; then
    echo '{"html_url":"https://github.com/tiann/hapi/pull/200"}'; exit 0
fi
# 777 only on fork
if [[ "$args" == *"repos/tiann/hapi/pulls/777"* ]]; then exit 1; fi
if [[ "$args" == *"repos/heavygee/hapi/pulls/777"* ]]; then
    echo '{"html_url":"https://github.com/heavygee/hapi/pull/777"}'; exit 0
fi
exit 1
EOF
chmod +x "$WORK/gh"

cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PUT"* && "\$args" == *"/external-refs"* ]]; then
    echo "\$args" >> "$WORK/put-refs.log"
    # capture body from -d next arg roughly: last JSON-looking token
    echo '{"ok":true,"externalRefs":[]}'
    exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"PR #100: needs work","externalRefs":[]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"eeeeeeee-5555","active":true,"metadata":{"name":"PR #777: fork-only","externalRefs":[]}},
 {"id":"ffffffff-6666","active":true,"metadata":{"name":"PR #404: missing everywhere","externalRefs":[]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run --backfill-refs 2>&1)"
check "backfill dry: plans write #100" "grep -q 'aaaaaaaa' <<<\"\$out\" && grep -q 'tiann/hapi#100' <<<\"\$out\""
check "backfill dry: skips #200 already attached" "grep -qi 'already has' <<<\"\$out\" && grep -q 'bbbbbbbb' <<<\"\$out\""
check "backfill dry: fork resolve #777" "grep -q 'heavygee/hapi#777' <<<\"\$out\""
check "backfill dry: unresolved #404" "grep -q 'ffffffff' <<<\"\$out\" && grep -qi 'UNRESOLVED\\|not on' <<<\"\$out\""
check "backfill dry: no PUT" "[[ ! -f '$WORK/put-refs.log' ]]"
check "backfill dry: prints apply hint" "grep -q -- '--apply' <<<\"\$out\""

out="$(run --backfill-refs --apply 2>&1)"
check "backfill apply: PUT log exists" "[[ -f '$WORK/put-refs.log' ]]"
puts="$(wc -l <"$WORK/put-refs.log")"
check "backfill apply: two PUTs (#100 + #777)" "[[ \$puts -eq 2 ]]"

# ============ 15. chipped sessions: strip title emoji; never write emoji titles ============
rm -f "$WORK/state.json" "$WORK/renames.log"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then
    echo "\$args" >> "$WORK/renames.log"
    # body is -d next arg
    prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then echo "\$a" >> "$WORK/renames.log"; fi
        prev="\$a"
    done
    echo '{"ok":true}'; exit 0
fi
if [[ "\$args" == *"-X PUT"* && "\$args" == *"/external-refs"* ]]; then
    echo '{"ok":true,"externalRefs":[]}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"⚠️PR #100: needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary","source":"inferred","linkedAt":1}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing","externalRefs":[]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run --dry-run --no-ping 2>&1)"
check "chip-strip dry: strips emoji from chipped #100" "grep -q 'aaaaaaaa' <<<\"\$out\" && grep -q 'chip owns status' <<<\"\$out\""
check "chip-strip dry: target title has no leading emoji" "grep -qE '→[[:space:]]+PR #100: needs work' <<<\"\$out\""
check "chip-strip dry: unchipped #200 not emoji-retitled" "! grep -q '✅PR #200' <<<\"\$out\""

out="$(run --no-ping 2>&1)"
check "chip-strip apply: PATCH fired for #100" "grep -q 'aaaaaaaa' '$WORK/renames.log'"
check "chip-strip apply: body is emoji-free title" "grep -q 'PR #100: needs work' '$WORK/renames.log'"

# ============ 16. --pr N: only that PR; no set -u crash on other chipped sessions ============
rm -f "$WORK/state.json" "$WORK/renames.log" "$WORK/put-refs.log"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then
    echo "\$args" >> "$WORK/renames.log"
    prev=""
    for a in "\$@"; do
        if [[ "\$prev" == "-d" ]]; then echo "\$a" >> "$WORK/renames.log"; fi
        prev="\$a"
    done
    echo '{"ok":true}'; exit 0
fi
if [[ "\$args" == *"-X PUT"* && "\$args" == *"/external-refs"* ]]; then
    echo "\$args" >> "$WORK/put-refs.log"
    echo '{"ok":true,"externalRefs":[]}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"⚠️PR #100: needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary","source":"inferred","linkedAt":1}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"PR #200: green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary","source":"inferred","linkedAt":1}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run --pr 100 --no-ping 2>&1)" || status=$?
status=${status:-0}
check "--pr: exits 0 (no set -u on other chipped sessions)" "[[ \$status -eq 0 ]]"
check "--pr: classifies only #100" "grep -qE 'classifying 1 PR|NEEDS WORK' <<<\"\$out\""
check "--pr: strips emoji on #100 session" "grep -q 'aaaaaaaa' <<<\"\$out\" && grep -q 'chip owns status' <<<\"\$out\""
check "--pr: does not touch #200 title" "! grep -q 'bbbbbbbb' '$WORK/renames.log' 2>/dev/null"

echo ""
echo "hapi-meta-daily.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
