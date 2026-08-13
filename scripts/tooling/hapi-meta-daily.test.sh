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
        # Keep inside the default 7-day Meta lookback (calendar-stable).
        notif_ts="$(date -u -d '2 days ago' +%Y-%m-%dT08:00:00Z 2>/dev/null || date -u +%Y-%m-%dT08:00:00Z)"
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
        200) j="$(echo "$j" | jq -c '. + {"200":{emoji:"✅",action:"full green - wait on tiann",prePr:false,merged:false}}')" ;;
        300) j="$(echo "$j" | jq -c '. + {"300":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
        400) j="$(echo "$j" | jq -c '. + {"400":{emoji:"⚠️",action:"fix failing CI",prePr:false,merged:false}}')" ;;
        600) j="$(echo "$j" | jq -c '. + {"600":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false}}')" ;;
        999) j="$(echo "$j" | jq -c '. + {"999":{emoji:"⚠️",action:"push to trigger bot review",prePr:false,merged:false}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"

# --- mock curl (hub) ------------------------------------------------------
# auth → token; sessions → 5 PR-tagged sessions; PATCH → ok
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}},
 {"id":"ffffffff-6666","active":true,"thinking":true,"metadata":{"name":"running warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":600,"url":"https://github.com/tiann/hapi/pull/600","role":"primary"}]}}
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

# Idle driver-status mock (quiet exit 0) unless a test replaces it.
cat >"$WORK/driver-status" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$WORK/driver-status"
# Empty manifest → no active layers (wave members clean for worktree/path).
# Early ping-policy tests need #300 Gate A *dirty* so 🔧 still hourly-pings.
# Section 18 wave-clear resets this to empty.
cat >"$WORK/manifest.yaml" <<'EOF'
# PR #300 still in soup — Gate A dirty
- branch: feat/shipped-thing
EOF

echo '{"logins":["tiann"]}' >"$WORK/pr-hold.json"

run() {
    rm -f "$WORK/pings.log"
    HAPI_META_GH_BIN="$WORK/gh" \
    HAPI_META_CURL_BIN="$WORK/curl" \
    HAPI_META_BATCH_BIN="$WORK/batch" \
    HAPI_META_PING_BIN="$WORK/ping" \
    HAPI_META_STATE="$WORK/state.json" \
    HAPI_META_MANIFEST="$WORK/manifest.yaml" \
    HAPI_META_DRIVER_STATUS_BIN="$WORK/driver-status" \
    HAPI_SETTINGS="$WORK/settings.json" \
    HAPI_PR_HOLD_CONFIG="$WORK/pr-hold.json" \
    HAPI_PR_HOLD_LOGINS="" \
    HAPI_HOST="http://mock" \
    bash "$SCRIPT" "$@"
}

# Operator-only hold-ack; tests have no controlling tty.
# Unset HAPI_AGENT_CONTEXT so harness runs under a live agent session do not
# inherit the production refuse (explicit agent tests set it themselves).
hold_ack() {
    HAPI_HOLD_ACK_ALLOW_NO_TTY=1 HAPI_AGENT_CONTEXT= bash "$DIR/hapi-hold-ack.sh" "$@"
}

# ============ 1. dry-run writes no state ============
rm -f "$WORK/state.json"
out="$(run --dry-run 2>&1)"
check "dry-run: no state file written" "[[ ! -f '$WORK/state.json' ]]"
check "dry-run: reports warn #100" "grep -q 'NEEDS WORK' <<<\"\$out\""
check "dry-run: reports merged #300" "grep -q 'MERGED' <<<\"\$out\""
check "dry-run: orphan #999 surfaced" "grep -q '#999' <<<\"\$out\""
check "dry-run: asleep #400 resume-ping planned" "grep -q 'dddddddd' <<<\"\$out\" && grep -qiE 'dry-run.*ping|PINGED' <<<\"\$out\""
check "dry-run: new comms surfaced" "grep -q 'NEW GITHUB COMMS' <<<\"\$out\""

# ============ 2. first real run: pings fire, state written ============
rm -f "$WORK/state.json"
out="$(run 2>&1)"
pings="$(sort "$WORK/pings.log" 2>/dev/null || true)"
check "run1: state written" "[[ -f '$WORK/state.json' ]]"
check "run1: pinged #100 warn (aaaaaaaa)" "grep -q '^aaaaaaaa' <<<\"\$pings\""
check "run1: pinged #300 merged (cccccccc)" "grep -q '^cccccccc' <<<\"\$pings\""
check "run1: ✅ #200 first-sight transition pings (bbbbbbbb)" "grep -q '^bbbbbbbb' <<<\"\$pings\""
check "run1: #400 asleep resume-pinged (C)" "grep -q '^dddddddd' <<<\"\$pings\""
check "run1: thinking ⚠️ #600 not pinged (ffffffff)" "! grep -q '^ffffffff' <<<\"\$pings\""

# ============ 3. second run: window-rouse sticky ⚠️/🔧; ✅ stays quiet ============
out="$(run 2>&1)"
pings2="$(sort "$WORK/pings.log" 2>/dev/null || true)"
check "run2: window-rouse re-pings ⚠️ #100" "grep -q '^aaaaaaaa' <<<\"\$pings2\""
check "run2: window-rouse re-pings 🔧 #300" "grep -q '^cccccccc' <<<\"\$pings2\""
check "run2: window-rouse re-pings asleep ⚠️ #400" "grep -q '^dddddddd' <<<\"\$pings2\""
check "run2: thinking ⚠️ #600 still not pinged" "! grep -q '^ffffffff' <<<\"\$pings2\""
check "run2: thinking skip listed" "grep -q 'ffffffff' <<<\"\$out\" && grep -qiE 'thinking|SKIPPED' <<<\"\$out\""
check "run2: ✅ #200 stays silent (not work-state)" "! grep -q '^bbbbbbbb' <<<\"\$pings2\""
check "run2: still lists warn #100 in queue" "grep -q '#100' <<<\"\$out\""

# ============ 4. sticky ✅ still silent even when reminder would fire for warn ============
tmp="$(jq -c '(.sessions["aaaaaaaa-1111"].last_ping) = 1' "$WORK/state.json")"
echo "$tmp" >"$WORK/state.json"
out="$(run --reminder-hours 1 2>&1)"
pings3="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "run3: ⚠️ #100 still window-roused" "grep -q '^aaaaaaaa' <<<\"\$pings3\""
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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
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

# ============ 9. quiet --no-ping --emit-events second run → zero POSTs ============
rm -f "$WORK/events.log"
out="$(run --no-ping --emit-events 2>&1)"
check "emit run2: zero POSTs (steady quiet)" "[[ ! -f '$WORK/events.log' ]]"

# ============ 9b. ping-window --emit-events second run → window POSTs for ⚠️/🔧 ============
rm -f "$WORK/events.log"
out="$(run --emit-events 2>&1)"
check "emit window: sticky work POSTs" "[[ -f '$WORK/events.log' ]]"
check "emit window: payload uses window reason key" \
    "grep -qE ':window:|\"emitReason\": \"window\"|\"emitReason\":\"window\"' '$WORK/events.log' || jq -e 'select(.payload.emitReason==\"window\" or (.idempotencyKey|test(\":window:\")))' <'$WORK/events.log' >/dev/null"

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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --no-ping --emit-events --reminder-hours 1 2>&1)"
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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
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
# Bound is 2 days ago (matches initial gh mock notif_ts), not a hardcoded calendar day.
notif_bound="$(date -u -d '2 days ago' +%Y-%m-%dT08:00:00Z 2>/dev/null || date -u +%Y-%m-%dT08:00:00Z)"
check "notif cursor freeze: cursor not past failed notif" \
    "[[ -n \"\$c_fail\" && ! \"\$c_fail\" > \"\$notif_bound\" ]]"

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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}},
 {"id":"dddddddd-4444","active":false,"metadata":{"name":"asleep warn","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":400,"url":"https://github.com/tiann/hapi/pull/400","role":"primary"}]}}
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
    "[[ -n \"\$c_ok\" && \"\$c_ok\" > \"\$notif_bound\" ]]"
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
 {"id":"3c141438-aaaa","active":true,"metadata":{"name":"green thing","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}},
 {"id":"136df8b7-bbbb","active":true,"metadata":{"name":"green thing too","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}}
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
# Real gh prints 404 JSON on stdout and exits 1. Mimic that — a nonempty body
# must NOT count as resolve success (issue #1085 / Peer-title chip bug).
emit_404() {
    echo '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}'
    exit 1
}
if [[ "$args" == *"repos/tiann/hapi/pulls/100"* ]]; then
    echo 'https://github.com/tiann/hapi/pull/100'; exit 0
fi
if [[ "$args" == *"repos/tiann/hapi/pulls/200"* ]]; then
    echo 'https://github.com/tiann/hapi/pull/200'; exit 0
fi
# 777 only on fork
if [[ "$args" == *"repos/tiann/hapi/pulls/777"* ]]; then emit_404; fi
if [[ "$args" == *"repos/heavygee/hapi/pulls/777"* ]]; then
    echo 'https://github.com/heavygee/hapi/pull/777'; exit 0
fi
# Issue-only number (Peer title trap)
if [[ "$args" == *"pulls/1085"* ]]; then emit_404; fi
emit_404
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
 {"id":"ffffffff-6666","active":true,"metadata":{"name":"PR #404: missing everywhere","externalRefs":[]}},
 {"id":"c076fffe-aaaa","active":true,"metadata":{"name":"Peer #1085: Dogfood: #1085 hang","externalRefs":[]}},
 {"id":"deadbeef-bbbb","active":true,"metadata":{"name":"Issue mention only #921 in prose","externalRefs":[]}}
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
check "backfill dry: ignores Peer #1085 (issue)" "! grep -q '1085' <<<\"\$out\""
check "backfill dry: ignores bare #921 mention" "! grep -q 'deadbeef\\|921' <<<\"\$out\""
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
check "chip-strip dry: strips emoji from chipped #100" "grep -q 'aaaaaaaa' <<<\"\$out\" && grep -q 'chip owns identity' <<<\"\$out\""
check "chip-strip dry: chipped title drops PR #N: prefix" "grep -qE '→[[:space:]]+needs work' <<<\"\$out\""
check "chip-strip dry: unchipped #200 not emoji-retitled" "! grep -q '✅PR #200' <<<\"\$out\""

out="$(run --no-ping 2>&1)"
check "chip-strip apply: PATCH fired for #100" "grep -q 'aaaaaaaa' '$WORK/renames.log'"
check "chip-strip apply: body is workstream title only" "grep -q 'needs work' '$WORK/renames.log'"

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
check "--pr: strips emoji on #100 session" "grep -q 'aaaaaaaa' <<<\"\$out\" && grep -q 'chip owns identity' <<<\"\$out\""
check "--pr: does not touch #200 title" "! grep -q 'bbbbbbbb' '$WORK/renames.log' 2>/dev/null"

# ============ 17. Peer #issue title must not mask github_pr chip ============
rm -f "$WORK/state.json" "$WORK/renames.log" "$WORK/put-refs.log"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '1087\n'; exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        1085) j="$(echo "$j" | jq -c '. + {"1085":{emoji:"📝",action:"pre-PR — no open PR",prePr:true,merged:false}}')" ;;
        1087) j="$(echo "$j" | jq -c '. + {"1087":{emoji:"✅",action:"full green - wait on tiann",prePr:false,merged:false}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"-X PUT"* && "\$args" == *"/external-refs"* ]]; then
    echo "\$args" >> "$WORK/put-refs.log"
    echo '{"ok":true,"externalRefs":[]}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"43c0f634-d09b-49e2-9e76-852015f87181","active":true,"metadata":{"name":"Peer #1085: Cursor worktree ACP stdout banner crash","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1087,"url":"https://github.com/tiann/hapi/pull/1087","role":"primary","source":"agent","linkedAt":1}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run --pr 1087 --no-ping 2>&1)"
check "chip-over-peer: does not orphan #1087" "! grep -q 'NO HAPI session' <<<\"\$out\""
check "chip-over-peer: updates chip for session" "grep -q '43c0f634' <<<\"\$out\" && grep -q 'CHIP STATUS' <<<\"\$out\""
check "chip-over-peer: PUT status for #1087" "grep -q 'external-refs' '$WORK/put-refs.log'"

# ============ 18. wave-clear: --no-ping stays ready; ping window unlocks tooling ============
: >"$WORK/manifest.yaml"
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    printf '300\tfix: shipped thing\t2026-07-24T02:52:06Z\n'; exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        300) j="$(echo "$j" | jq -c '. + {"300":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/curl" <<EOF
#!/usr/bin/env bash
args="\$*"
if [[ "\$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "\$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "\$args" == *"-X PUT"* && "\$args" == *"/external-refs"* ]]; then
    echo '{"ok":true,"externalRefs":[]}'; exit 0
fi
if [[ "\$args" == *"/api/system-events"* && "\$args" == *"-X POST"* ]]; then
    echo "\$args" >> "$WORK/events.log"
    echo '{"event":{"id":1},"deduped":false}'; exit 0
fi
if [[ "\$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"cccccccc-3333","active":true,"metadata":{"name":"merged cleanup done","path":"/tmp/not-a-worktree","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary","source":"agent","linkedAt":1}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(HAPI_META_TOOLING_SESSION_ID=meta-tooling-9999 run --no-ping --emit-events 2>&1)" || true
pings_np="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "wave no-ping: no unlock ping" "[[ -z \"\$pings_np\" ]]"
check "wave no-ping: state ready or collecting" "jq -e '.wave.status == \"ready\" or .wave.status == \"collecting\"' '$WORK/state.json' >/dev/null"
check "wave no-ping: defer awaiting_ping_window in queue" "grep -qE 'awaiting_ping_window|WAVE CLEAR' <<<\"\$out\""

rm -f "$WORK/pings.log"
out="$(HAPI_META_TOOLING_SESSION_ID=meta-tooling-9999 run --emit-events 2>&1)" || true
pings_u="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "wave ping: unlocks Meta tooling session" "grep -q '^meta-tool' <<<\"\$pings_u\""
check "wave ping: state dispatched" "jq -e '.wave.status == \"dispatched\"' '$WORK/state.json' >/dev/null"

# rebuild busy → no unlock (peer 🔧 policy ping may still fire; tooling must not)
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/driver-status" <<'EOF'
#!/usr/bin/env bash
exit 75
EOF
chmod +x "$WORK/driver-status"
out="$(HAPI_META_TOOLING_SESSION_ID=meta-tooling-9999 run 2>&1)" || true
pings_b="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "wave busy: no unlock ping to tooling" "! grep -q '^meta-tool' <<<\"\$pings_b\""
check "wave busy: stay ready" "jq -e '.wave.status == \"ready\"' '$WORK/state.json' >/dev/null"
check "wave busy: defer rebuild_busy" "grep -q 'rebuild_busy' <<<\"\$out\""

# soft-fail without tooling session id
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/driver-status" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$WORK/driver-status"
out="$(run 2>&1)" || true
pings_nt="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "wave no-tooling-id: no unlock to tooling" "! grep -q '^meta-tool' <<<\"\$pings_nt\""
check "wave no-tooling-id: stay ready" "jq -e '.wave.status == \"ready\"' '$WORK/state.json' >/dev/null"
check "wave no-tooling-id: hints env var" "grep -q 'HAPI_META_TOOLING_SESSION_ID' <<<\"\$out\""

# ============ 19. Sparling estate fence (2026-08-06) — bare #395 must not latch ============
# Foreign path + bare #NNN title must NEVER classify as tiann/hapi PR or get 🔧 pings.
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        395) j="$(echo "$j" | jq -c '. + {"395":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
        *) j="$(echo "$j" | jq -c --arg p "$a" '. + {($p):{emoji:"📝",action:"pre-PR",prePr:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
# No open/merged PRs — discovery must come only from sessions (should be none).
args="$*"
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"sparling1-3950","active":true,"metadata":{"name":"Module 02: support case schema #395","path":"/home/heavygee/coding/sparling"}},
 {"id":"sparling2-3951","active":true,"metadata":{"name":"Peer #395: sparling trap","path":"/home/heavygee/coding/sparling"}},
 {"id":"hapiok00-1100","active":true,"metadata":{"name":"Peer #1100: incubating","path":"/home/heavygee/coding/hapi/worktrees/peer-1100"}},
 {"id":"titleonly-9999","active":true,"metadata":{"name":"PR #999: title only no chip","path":"/home/heavygee/coding/hapi/worktrees/x"}},
 {"id":"foreignchip-888","active":true,"metadata":{"name":"linked elsewhere","path":"/home/heavygee/coding/sparling","externalRefs":[{"kind":"github_pr","repo":"other/sparling","number":395,"url":"https://github.com/other/sparling/pull/395","role":"primary"}]}},
 {"id":"hapichip-1368","active":true,"metadata":{"name":"workstream only title","path":"/home/heavygee/coding/hapi/worktrees/y","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --dry-run 2>&1)" || true
pings_s="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "sparling fence: bare #395 never appears as tracked PR" "! grep -qE '(^|[^0-9])395([^0-9]|$)|#395' <<<\"\$out\""
check "sparling fence: no sparling session id in output as tracked" "! grep -q 'sparling1\\|sparling2' <<<\"\$out\""
check "sparling fence: Peer #395 on sparling path ignored" "! grep -q 'sparling2' <<<\"\$out\""
check "sparling fence: title-only PR #999 ignored" "! grep -q 'titleonly' <<<\"\$out\""
check "sparling fence: non-hapi github_pr chip ignored" "! grep -q 'foreignchip' <<<\"\$out\""
check "sparling fence: hapi chip tracked despite workstream title" "grep -qE '#200|200' <<<\"\$out\""
check "sparling fence: incubating Peer #1100 without chip ignored" "! grep -q 'hapiok00\\|1100' <<<\"\$out\""
check "sparling fence: dry-run no pings" "[[ -z \"\$pings_s\" ]]"
# Stronger: batch must never be asked to classify 395 from these sessions.
# Re-run with batch that dies if 395 is passed.
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
    if [[ "$a" == "395" ]]; then
        echo "FAIL: classified Sparling #395 as hapi PR" >&2
        exit 99
    fi
done
echo '{}'
EOF
chmod +x "$WORK/batch"
out="$(run --dry-run 2>&1)" || rc=$?
rc=${rc:-0}
check "sparling fence: batch never sees 395 (exit!=99)" "[[ \$rc -ne 99 ]]"
check "sparling fence: no FAIL classify message" "! grep -q 'classified Sparling' <<<\"\$out\""

# ============ 20. Empty metadata.name must still own the PR (2026-08-07 #1383) ============
# Bash IFS=$'\t' collapses consecutive tabs; @tsv with empty name used to shift
# fields and drop ownership → Meta logged "NO HAPI session" / chip went stale.
# Fix: NDJSON discovery + display-title label (summary/path). Do NOT PATCH-heal name
# (empty name is upstream-normal — change_title → summary.text only).
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    printf '1383\tfeat(web): storage pie\t2026-08-07T01:48:45Z\n'
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        1383) j="$(echo "$j" | jq -c '. + {"1383":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then
    echo "UNEXPECTED PATCH blank-name heal" >&2
    exit 1
fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"18c0f3d5-4763-4735-bb64-f5fe7ac7d35d","active":false,"metadata":{"name":"","summary":{"text":"Storage Display","updatedAt":1},"path":"/home/heavygee/coding/hapi","lifecycleState":"running","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1383,"url":"https://github.com/tiann/hapi/pull/1383","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --dry-run --json --pr 1383 2>&1)" || true
check "empty-name chip: owns #1383 (not orphan)" "! grep -q 'NO HAPI session\\|no owning session' <<<\"\$out\""
check "empty-name chip: session id appears in plan" "grep -q '18c0f3d5' <<<\"\$out\""
check "empty-name chip: #1383 in plan prs" "grep -q '1383' <<<\"\$out\""
check "empty-name chip: display title from summary" "grep -q 'Storage Display' <<<\"\$out\""
check "empty-name chip: no blank-name PATCH heal" "! grep -qE 'heal blank name|blank-name heal|UNEXPECTED PATCH' <<<\"\$out\""

# ============ 21. Display-title fallback: summary → path; named kept; no heal ============
rm -f "$WORK/state.json" "$WORK/pings.log"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    printf '9001\tfrom summary\t2026-08-07T01:00:00Z\n'
    printf '9002\tfrom path\t2026-08-07T01:00:00Z\n'
    printf '9003\tnamed keep\t2026-08-07T01:00:00Z\n'
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        9001) j="$(echo "$j" | jq -c '. + {"9001":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
        9002) j="$(echo "$j" | jq -c '. + {"9002":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
        9003) j="$(echo "$j" | jq -c '. + {"9003":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then
    echo "UNEXPECTED PATCH in display-title test" >&2
    exit 1
fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"aaaa-summary-0000-0000-000000000001","active":false,"metadata":{"name":"  ","summary":{"text":"From Summary"},"path":"/tmp/proj","lifecycleState":"running","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":9001,"url":"https://github.com/tiann/hapi/pull/9001","role":"primary"}]}},
 {"id":"bbbb-pathonly-0000-0000-000000000002","active":false,"metadata":{"name":"","path":"/home/heavygee/coding/hapi/worktrees/foo","lifecycleState":"running","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":9002,"url":"https://github.com/tiann/hapi/pull/9002","role":"primary"}]}},
 {"id":"cccc-named-0000-0000-000000000003","active":false,"metadata":{"name":"Keep Me","summary":{"text":"ignored"},"path":"/tmp/x","lifecycleState":"running","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":9003,"url":"https://github.com/tiann/hapi/pull/9003","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(run --dry-run --json 2>&1)" || true
check "display title: summary preferred over path" "grep -q 'From Summary' <<<\"\$out\""
check "display title: path basename when no summary" "grep -qE '\"title\": ?\"foo\"' <<<\"\$out\""
check "display title: named session kept" "grep -q 'Keep Me' <<<\"\$out\""
check "display title: never blank-name heal" "! grep -qE 'heal blank name|blank-name heal' <<<\"\$out\""
check "display title: dry-run never PATCHes" "! grep -q 'UNEXPECTED PATCH' <<<\"\$out\""

# ============ 22. operator hold: tiann comment latches 🛑; bots never; ack clears ============
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/events.log"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        100) j="$(echo "$j" | jq -c '. + {"100":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false,dataUnavailable:false}}')" ;;
        200) j="$(echo "$j" | jq -c '. + {"200":{emoji:"✅",action:"full green - wait on tiann",prePr:false,merged:false}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '100\n200\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    exit 0
fi
if [[ "$args" == *"issues/100/comments"* ]]; then
    cat <<'JSON'
[{"id":5154418101,"user":{"login":"tiann","type":"User"},"body":"please trim the upgrade stack","html_url":"https://github.com/tiann/hapi/pull/100#issuecomment-5154418101","created_at":"2026-08-02T01:26:00Z"}]
JSON
    exit 0
fi
if [[ "$args" == *"issues/200/comments"* ]]; then
    cat <<'JSON'
[{"id":99,"user":{"login":"github-actions[bot]","type":"Bot"},"body":"**Findings**\n- [Major] nit","html_url":"https://github.com/tiann/hapi/pull/200#issuecomment-99","created_at":"2026-08-02T01:26:00Z"}]
JSON
    exit 0
fi
if [[ "$args" == *"/reviews"* ]]; then
    echo '[]'; exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
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
 {"id":"aaaaaaaa-1111","active":true,"metadata":{"name":"needs work","path":"/home/heavygee/coding/hapi/worktrees/foo","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":100,"url":"https://github.com/tiann/hapi/pull/100","role":"primary"}]}},
 {"id":"bbbbbbbb-2222","active":true,"metadata":{"name":"green thing","path":"/home/heavygee/coding/hapi/worktrees/bar","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":200,"url":"https://github.com/tiann/hapi/pull/200","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run 2>&1)"
pings_h="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "hold: queue lists OPERATOR HOLD for #100" "grep -A6 'OPERATOR HOLD' <<<\"\$out\" | grep -q '#100'"
check "hold: tiann comment latched in state" "jq -e --arg k 'tiann/hapi#100' '.hold[\$k].acked == false' '$WORK/state.json' >/dev/null"
check "hold: tiann comment id stored" "jq -e --arg k 'tiann/hapi#100' '.hold[\$k].comment_id == \"5154418101\"' '$WORK/state.json' >/dev/null"
check "hold: coding peer aaaaaaaa NOT pinged" "! grep -q '^aaaaaaaa' <<<\"\$pings_h\""
check "hold: bot Findings on #200 did not latch" "! jq -e --arg k 'tiann/hapi#200' '.hold[\$k].acked == false' '$WORK/state.json' >/dev/null"
check "hold: latch emits without --emit-events (hourly timer path)" "[[ -f '$WORK/events.log' ]] && grep -q 'aaaaaaaa-1111' '$WORK/events.log'"

rm -f "$WORK/pings.log" "$WORK/events.log"
out="$(run 2>&1)"
pings_h2="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "hold: second run still does not ping peer" "! grep -q '^aaaaaaaa' <<<\"\$pings_h2\""
check "hold: second run no new emit (silence)" "[[ ! -f '$WORK/events.log' ]]"

hold_ack --state "$WORK/state.json" --repo tiann/hapi 100
check "hold-ack: acked true" "jq -e --arg k 'tiann/hapi#100' '.hold[\$k].acked == true' '$WORK/state.json' >/dev/null"

rm -f "$WORK/pings.log"
out="$(run 2>&1)"
pings_h3="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "hold-ack: next run returns to live ⚠️ ping" "grep -q '^aaaaaaaa' <<<\"\$pings_h3\""
check "hold-ack: OPERATOR HOLD gone from queue" "! grep -q 'OPERATOR HOLD' <<<\"\$out\""

# ============ 23. fork chip repo wins when the number collides with tiann ============
# heavygee/hapi#124 (open) vs tiann/hapi#124 (closed Jan 2026, no merge).
# Classifying every number against UPSTREAM_REPO sticky-pings "closed WITHOUT merge".
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/batch.args"
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
echo "$@" >> "${HAPI_META_BATCH_ARGS_LOG:-/dev/null}"
repo="tiann/hapi"
j='{}'
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) repo="$2"; shift 2 ;;
        [0-9]*)
            n="$1"
            if [[ "$n" == "124" && "$repo" == "tiann/hapi" ]]; then
                j="$(echo "$j" | jq -c --arg n "$n" '.[$n]={emoji:"⚠️",action:"PR closed WITHOUT merge — reopen or drop",prePr:false,merged:false,closed:true}')"
            elif [[ "$n" == "124" && "$repo" == "heavygee/hapi" ]]; then
                j="$(echo "$j" | jq -c --arg n "$n" '.[$n]={emoji:"🔁",action:"CI running",prePr:false,merged:false,closed:false}')"
            elif [[ "$n" == "100" ]]; then
                j="$(echo "$j" | jq -c '. + {"100":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false}}')"
            fi
            shift
            ;;
        *) shift ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '100\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"e76e5a9f-a7e3-463b-888c-f0f294b369f9","active":true,"metadata":{"name":"Peer #121: operator hold chip","path":"/home/heavygee/coding/hapi/worktrees/operator-hold-chip","externalRefs":[{"kind":"github_pr","repo":"heavygee/hapi","number":124,"url":"https://github.com/heavygee/hapi/pull/124","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

set +e
out="$(HAPI_META_BATCH_ARGS_LOG="$WORK/batch.args" run --dry-run 2>&1)"
rc=$?
set -e
[[ $rc -eq 0 ]] || printf '%s\n' "$out" >&2
check "fork chip: meta-daily exits 0" "[[ $rc -eq 0 ]]"
check "fork chip: batch invoked with --repo heavygee/hapi" "grep -q -- '--repo heavygee/hapi' '$WORK/batch.args'"
check "fork chip: does not inherit tiann closed-without-merge" "! grep -q 'closed WITHOUT merge' <<<\"\$out\""
check "fork chip: live classify is fork CI/pending" "grep -q 'CI running' <<<\"\$out\""

# Dual chips, same number: tiann#124 closed-unmerged must not paint the fork session.
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/batch.args"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"e76e5a9f-a7e3-463b-888c-f0f294b369f9","active":true,"metadata":{"name":"Peer #121: operator hold chip","path":"/home/heavygee/coding/hapi/worktrees/operator-hold-chip","externalRefs":[{"kind":"github_pr","repo":"heavygee/hapi","number":124,"url":"https://github.com/heavygee/hapi/pull/124","role":"primary"}]}},
 {"id":"aaaa1240-0000-4000-8000-tiannclosed01","active":true,"metadata":{"name":"env port leftover","path":"/home/heavygee/coding/hapi/worktrees/old-port","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":124,"url":"https://github.com/tiann/hapi/pull/124","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
set +e
out="$(HAPI_META_BATCH_ARGS_LOG="$WORK/batch.args" run --dry-run --no-ping 2>&1)"
rc=$?
set -e
[[ $rc -eq 0 ]] || printf '%s\n' "$out" >&2
check "dual chip: exits 0" "[[ $rc -eq 0 ]]"
check "dual chip: classifies both repos" "grep -q -- '--repo heavygee/hapi' '$WORK/batch.args' && grep -q -- '--repo tiann/hapi' '$WORK/batch.args'"
check "dual chip: fork session keeps CI running" "grep -A2 'e76e5a9f' <<<\"\$out\" | grep -q 'CI running' || grep -q 'e76e5a9f  →  🔁' <<<\"\$out\""
check "dual chip: tiann session keeps closed-without-merge" "grep -q 'closed WITHOUT merge' <<<\"\$out\""

# Bare hold-ack resolves unique heavygee row (not tiann default).
cat >"$WORK/hold-only.json" <<'EOF'
{"schema":1,"hold":{"heavygee/hapi#124":{"acked":false,"comment_id":"1","notified":true}}}
EOF
hold_ack --state "$WORK/hold-only.json" 124
check "hold-ack bare number: acked heavygee row" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == true' '$WORK/hold-only.json' >/dev/null"

# Dual unacked holds for the same number must refuse bare ack (no silent tiann default).
cat >"$WORK/hold-dual.json" <<'EOF'
{"schema":1,"hold":{
  "tiann/hapi#124":{"acked":false,"comment_id":"1"},
  "heavygee/hapi#124":{"acked":false,"comment_id":"2"}
}}
EOF
set +e
dual_out="$(hold_ack --state "$WORK/hold-dual.json" 124 2>&1)"
dual_rc=$?
set -e
check "hold-ack ambiguous bare: nonzero" "[[ $dual_rc -ne 0 ]]"
check "hold-ack ambiguous bare: demands --repo" "grep -qi 'ambiguous\\|pass --repo' <<<\"\$dual_out\""
check "hold-ack ambiguous bare: neither row acked" "jq -e --arg a 'tiann/hapi#124' --arg b 'heavygee/hapi#124' '.hold[\$a].acked == false and .hold[\$b].acked == false' '$WORK/hold-dual.json' >/dev/null"
hold_ack --state "$WORK/hold-dual.json" --repo heavygee/hapi 124
check "hold-ack ambiguous with --repo: fork acked" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == true' '$WORK/hold-dual.json' >/dev/null"
check "hold-ack ambiguous with --repo: tiann still held" "jq -e --arg k 'tiann/hapi#124' '.hold[\$k].acked == false' '$WORK/hold-dual.json' >/dev/null"

# Authored open tiann#124 + fork chip only: classify upstream pair; orphan tiann.
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/batch.args"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '124\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/api/auth"* ]]; then echo '{"token":"JWT"}'; exit 0; fi
if [[ "$args" == *"-X PATCH"* ]]; then echo '{"ok":true}'; exit 0; fi
if [[ "$args" == *"/api/sessions?limit=500"* ]]; then
cat <<'JSON'
{"sessions":[
 {"id":"e76e5a9f-a7e3-463b-888c-f0f294b369f9","active":true,"metadata":{"name":"Peer #121: operator hold chip","path":"/home/heavygee/coding/hapi/worktrees/operator-hold-chip","externalRefs":[{"kind":"github_pr","repo":"heavygee/hapi","number":124,"url":"https://github.com/heavygee/hapi/pull/124","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
set +e
out="$(HAPI_META_BATCH_ARGS_LOG="$WORK/batch.args" run --dry-run --no-ping 2>&1)"
rc=$?
set -e
[[ $rc -eq 0 ]] || printf '%s\n' "$out" >&2
check "upstream discover: classifies tiann and fork" "grep -q -- '--repo heavygee/hapi' '$WORK/batch.args' && grep -q -- '--repo tiann/hapi' '$WORK/batch.args'"
check "upstream discover: fork session not painted closed" "! grep -q 'e76e5a9f  →  ⚠️' <<<\"\$out\" || grep -q 'CI running' <<<\"\$out\""
check "upstream discover: tiann#124 is orphan" "grep -q 'tiann/hapi#124' <<<\"\$out\" && grep -qi 'NO HAPI session\\|orphan' <<<\"\$out\""

# Hold ingest must be pair-owned. Authored tiann#124 + fork chip on heavygee#124
# used to pass the number-only PR_SESSIONS gate and latch a stale upstream 🛑.
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/events.log" "$WORK/gh.args"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
echo "$args" >> "${HAPI_META_GH_ARGS_LOG:-/dev/null}"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '124\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    exit 0
fi
if [[ "$args" == *"repos/tiann/hapi/issues/124/comments"* ]]; then
    cat <<'JSON'
[{"id":9001,"user":{"login":"tiann","type":"User"},"body":"hold the fork work","html_url":"https://github.com/tiann/hapi/pull/124#issuecomment-9001","created_at":"2026-08-11T22:00:00Z"}]
JSON
    exit 0
fi
if [[ "$args" == *"repos/heavygee/hapi/issues/124/comments"* ]]; then
    cat <<'JSON'
[{"id":9002,"user":{"login":"tiann","type":"User"},"body":"please hold this fork PR","html_url":"https://github.com/heavygee/hapi/pull/124#issuecomment-9002","created_at":"2026-08-11T22:01:00Z"}]
JSON
    exit 0
fi
if [[ "$args" == *"/reviews"* ]]; then
    echo '[]'; exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
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
 {"id":"e76e5a9f-a7e3-463b-888c-f0f294b369f9","active":true,"metadata":{"name":"Peer #121: operator hold chip","path":"/home/heavygee/coding/hapi/worktrees/operator-hold-chip","externalRefs":[{"kind":"github_pr","repo":"heavygee/hapi","number":124,"url":"https://github.com/heavygee/hapi/pull/124","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"
out="$(HAPI_META_GH_ARGS_LOG="$WORK/gh.args" run 2>&1)"
check "hold pair-own: heavygee latch only" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == false' '$WORK/state.json' >/dev/null"
check "hold pair-own: unlinked tiann not latched" "! jq -e --arg k 'tiann/hapi#124' '.hold | has(\$k)' '$WORK/state.json' >/dev/null"
check "hold pair-own: skip tiann comment fetch" "! grep -q 'repos/tiann/hapi/issues/124/comments' '$WORK/gh.args'"
check "hold pair-own: fetch owned fork comments" "grep -q 'repos/heavygee/hapi/issues/124/comments' '$WORK/gh.args'"
check "hold pair-own: OPERATOR HOLD is fork #124" "grep -A6 'OPERATOR HOLD' <<<\"\$out\" | grep -q 'heavygee/hapi#124\\| #124'"

# hold-ack must not claim success when jq cannot serialize.
mkdir -p "$WORK/jqbin"
cat >"$WORK/jqbin/jq" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "." && $# -eq 1 ]]; then
    exit 1
fi
exec /usr/bin/jq "$@"
EOF
chmod +x "$WORK/jqbin/jq"
cat >"$WORK/hold-fail.json" <<'EOF'
{"schema":1,"hold":{"heavygee/hapi#124":{"acked":false,"comment_id":"1"}}}
EOF
set +e
ack_out="$(PATH="$WORK/jqbin:$PATH" hold_ack --state "$WORK/hold-fail.json" --repo heavygee/hapi 124 2>&1)"
ack_rc=$?
set -e
check "hold-ack serialize fail: nonzero" "[[ $ack_rc -ne 0 ]]"
check "hold-ack serialize fail: no success line" "! grep -q 'acked heavygee/hapi#124' <<<\"\$ack_out\""
check "hold-ack serialize fail: row still unacked" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == false' '$WORK/hold-fail.json' >/dev/null"

# Agent context must not clear holds (Codex P1) — even with the no-TTY test override.
set +e
agent_out="$(HAPI_AGENT_CONTEXT=1 HAPI_HOLD_ACK_ALLOW_NO_TTY= bash "$DIR/hapi-hold-ack.sh" --state "$WORK/hold-fail.json" --repo heavygee/hapi 124 2>&1)"
agent_rc=$?
set -e
check "hold-ack agent context: nonzero" "[[ $agent_rc -ne 0 ]]"
check "hold-ack agent context: refuses" "grep -qi 'agent context\\|controlling tty\\|operator' <<<\"\$agent_out\""
check "hold-ack agent context: row still unacked" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == false' '$WORK/hold-fail.json' >/dev/null"
set +e
agent_bypass_out="$(HAPI_AGENT_CONTEXT=1 HAPI_HOLD_ACK_ALLOW_NO_TTY=1 bash "$DIR/hapi-hold-ack.sh" --state "$WORK/hold-fail.json" --repo heavygee/hapi 124 2>&1)"
agent_bypass_rc=$?
set -e
check "hold-ack agent+ALLOW_NO_TTY: still nonzero" "[[ $agent_bypass_rc -ne 0 ]]"
check "hold-ack agent+ALLOW_NO_TTY: refuses agent" "grep -qi 'agent context' <<<\"\$agent_bypass_out\""
check "hold-ack agent+ALLOW_NO_TTY: row still unacked" "jq -e --arg k 'heavygee/hapi#124' '.hold[\$k].acked == false' '$WORK/hold-fail.json' >/dev/null"

# ============ 26. blockedUpstream stickyPing=false — no hourly peer nags (#128) ============
rm -f "$WORK/state.json" "$WORK/pings.log" "$WORK/events.log"
# Gate A dirty so mixed blocked+🔧 still owes cleanup pings (not archive-only silence).
cat >"$WORK/manifest.yaml" <<'EOF'
- branch: feat/shipped-thing
EOF
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        1511) j="$(echo "$j" | jq -c '. + {"1511":{emoji:"⚠️",action:"blocked upstream — wait on #1473 (status:blocked-upstream)",prePr:false,merged:false,closed:false,dataUnavailable:false,blockedUpstream:true,stickyPing:false}}')" ;;
        1512) j="$(echo "$j" | jq -c '. + {"1512":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false,dataUnavailable:false,blockedUpstream:false,stickyPing:true}}')" ;;
        300) j="$(echo "$j" | jq -c '. + {"300":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true,closed:false,blockedUpstream:false,stickyPing:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
cat >"$WORK/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"pr list"* && "$args" == *"--state open"* ]]; then
    printf '1511\n1512\n'; exit 0
fi
if [[ "$args" == *"pr list"* && "$args" == *"merged"* ]]; then
    printf '300\tfix: shipped thing\t2026-07-24T02:52:06Z\n'
    exit 0
fi
if [[ "$args" == *"notifications"* ]]; then
    exit 0
fi
if [[ "$args" == *"/comments"* || "$args" == *"/reviews"* ]]; then
    echo '[]'; exit 0
fi
exit 0
EOF
chmod +x "$WORK/gh"
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
 {"id":"bbbbbbbb-1511","active":true,"metadata":{"name":"spawn-peer remit blocked","path":"/tmp/wt-1511","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1511,"url":"https://github.com/tiann/hapi/pull/1511","role":"primary"}]}},
 {"id":"cccccccc-1512","active":true,"metadata":{"name":"actionable warn","path":"/tmp/wt-1512","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1512,"url":"https://github.com/tiann/hapi/pull/1512","role":"primary"}]}},
 {"id":"dddddddd-both","active":true,"metadata":{"name":"mixed blocked+actionable","path":"/tmp/wt-both","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1511,"url":"https://github.com/tiann/hapi/pull/1511","role":"primary"},{"kind":"github_pr","repo":"tiann/hapi","number":1512,"url":"https://github.com/tiann/hapi/pull/1512","role":"primary"}]}},
 {"id":"eeeeeeee-clean","active":true,"metadata":{"name":"mixed blocked+cleanup","path":"/tmp/wt-clean","externalRefs":[{"kind":"github_pr","repo":"tiann/hapi","number":1511,"url":"https://github.com/tiann/hapi/pull/1511","role":"related"},{"kind":"github_pr","repo":"tiann/hapi","number":300,"url":"https://github.com/tiann/hapi/pull/300","role":"primary"}]}}
]}
JSON
exit 0
fi
echo '{}'; exit 0
EOF
chmod +x "$WORK/curl"

out="$(run --emit-events 2>&1)"
pings_b1="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "blockedUpstream: still in NEEDS WORK queue" "grep -A20 'NEEDS WORK' <<<\"\$out\" | grep -q '#1511'"
check "blockedUpstream: first window does NOT ping blocked-only peer" "! grep -q '^bbbbbbbb' <<<\"\$pings_b1\""
check "blockedUpstream: actionable sibling session still pinged" "grep -q '^cccccccc' <<<\"\$pings_b1\""
check "blockedUpstream: mixed session still pinged (actionable ⚠️)" "grep -q '^dddddddd' <<<\"\$pings_b1\""
check "blockedUpstream: mixed blocked+🔧 still pinged (cleanup)" "grep -q '^eeeeeeee' <<<\"\$pings_b1\""
check "blockedUpstream: no transition emit for blocked-only" "! grep -q 'bbbbbbbb-1511' '$WORK/events.log' 2>/dev/null"

rm -f "$WORK/pings.log" "$WORK/events.log"
out="$(run --emit-events 2>&1)"
pings_b2="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "blockedUpstream: second window still zero peer pings" "! grep -q '^bbbbbbbb' <<<\"\$pings_b2\""
check "blockedUpstream: second window no window emit for blocked-only" "! grep -q 'bbbbbbbb-1511' '$WORK/events.log' 2>/dev/null"
check "blockedUpstream: second window still rouses actionable" "grep -q '^cccccccc' <<<\"\$pings_b2\""
check "blockedUpstream: second window still rouses blocked+🔧" "grep -q '^eeeeeeee' <<<\"\$pings_b2\""

# Label cleared → stickyPing true restores normal first-sight/window policy
cat >"$WORK/batch" <<'EOF'
#!/usr/bin/env bash
j='{}'
for a in "$@"; do
    case "$a" in
        1511) j="$(echo "$j" | jq -c '. + {"1511":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false,blockedUpstream:false,stickyPing:true}}')" ;;
        1512) j="$(echo "$j" | jq -c '. + {"1512":{emoji:"⚠️",action:"resolve 1 open thread(s)",prePr:false,merged:false,closed:false,blockedUpstream:false,stickyPing:true}}')" ;;
        300) j="$(echo "$j" | jq -c '. + {"300":{emoji:"🔧",action:"MERGED — clean up",prePr:false,merged:true,blockedUpstream:false,stickyPing:true}}')" ;;
    esac
done
echo "$j"
EOF
chmod +x "$WORK/batch"
rm -f "$WORK/pings.log"
out="$(run 2>&1)"
pings_b3="$(cat "$WORK/pings.log" 2>/dev/null || true)"
check "blockedUpstream cleared: peer ping resumes" "grep -q '^bbbbbbbb' <<<\"\$pings_b3\""

echo ""
echo "hapi-meta-daily.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
