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
    # one upstream comms item; fork repo → none
    if [[ "$args" == *"tiann/hapi/notifications"* ]]; then
        printf '2026-07-25T08:00:00Z\tPullRequest\tcomment\tRe: PR #100 please rebase\thttps://x\n'
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

echo ""
echo "hapi-meta-daily.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
