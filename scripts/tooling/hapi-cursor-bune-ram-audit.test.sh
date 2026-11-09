#!/usr/bin/env bash
# hapi-cursor-bune-ram-audit — red-driven fixtures.
# A green-only auditor proves nothing; every check here must also go red.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/hapi-cursor-bune-ram-audit.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SELF='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
LIVE_CURSOR='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
STALE_GAP='cccccccc-cccc-cccc-cccc-cccccccccccc'
PROT_LIVE='dddddddd-dddd-dddd-dddd-dddddddddddd'
SUPER_HUSK='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
GONE='ffffffff-ffff-ffff-ffff-ffffffffffff'

BUNE_CMD="bun --cwd /x/cli -e
import { runCursor } from './src/cursor/runCursor.ts';
await runCursor({
  existingSessionId: 'SID',
  workingDirectory: '/tmp/wt',
  resumeSessionId: 'cur-1',
  startedBy: 'runner',
  permissionMode: 'yolo',
});
"

write_config() {
    cat >"$WORK/meta-sessions.yaml" <<EOF
schema: 1
sessions:
  tooling_meta:
    name: tooling/meta bot
    id: $PROT_LIVE
    superseded: $SUPER_HUSK
EOF
}

write_sessions() {
    # Map form: id -> session object (fixture seam)
    jq -n \
        --arg self "$SELF" \
        --arg live "$LIVE_CURSOR" \
        --arg stale "$STALE_GAP" \
        --arg prot "$PROT_LIVE" \
        --arg husk "$SUPER_HUSK" \
        --argjson now "$(($(date +%s) * 1000))" \
        --argjson old "$((($(date +%s) - 20 * 86400) * 1000))" \
        '{
            ($self): {id:$self, active:true, thinking:false, updatedAt:$now,
                metadata:{name:"Peer: audit self", flavor:"cursor", lifecycleState:"running",
                    cursorSessionId:"cur-self", path:"/tmp/self", startedBy:"runner"}},
            ($live): {id:$live, active:true, thinking:false, updatedAt:$now,
                metadata:{name:"live cursor bune", flavor:"cursor", lifecycleState:"idle",
                    cursorSessionId:"cur-live", path:"/tmp/live", startedBy:"runner"}},
            ($stale): {id:$stale, active:false, thinking:false, updatedAt:$old,
                metadata:{name:"stale gap", flavor:"cursor", lifecycleState:"idle",
                    cursorSessionId:"cur-stale", path:"/tmp/stale", startedBy:"runner"}},
            ($prot): {id:$prot, active:true, thinking:false, updatedAt:$now,
                metadata:{name:"tooling/meta bot", flavor:"claude", lifecycleState:"running",
                    startedBy:"runner"}},
            ($husk): {id:$husk, active:false, thinking:false, updatedAt:$old,
                metadata:{name:"SUPERSEDED husk", flavor:"cursor", lifecycleState:"archived",
                    cursorSessionId:"cur-husk", path:"/tmp/husk", startedBy:"runner"}}
        }' >"$WORK/sessions.json"
}

cmd_for() {
    local sid="$1"
    printf '%s' "${BUNE_CMD//SID/$sid}"
}

write_store() {
    jq -n '{
        "cur-self": {"verdict":"OK","cause":"acp"},
        "cur-live": {"verdict":"OK","cause":"acp"},
        "cur-stale": {"verdict":"MISSING","cause":"never_persisted"},
        "cur-husk": {"verdict":"OK","cause":"acp"}
    }' >"$WORK/store.json"
}

run() {
    "$SCRIPT" \
        --config "$WORK/meta-sessions.yaml" \
        --sessions-json "$WORK/sessions.json" \
        --proc-json "$WORK/proc.json" \
        --resume-json "$WORK/resume.json" \
        --store-json "$WORK/store.json" \
        --self "$SELF" \
        --controls "$SELF,$LIVE_CURSOR,$PROT_LIVE" \
        --stale-days 7 \
        2>&1
}

# --- 1. Happy gate: self + live cursor NO by R4; stale untracked is CANDIDATE ---
write_config
write_sessions
write_store
jq -n \
    --arg self "$SELF" \
    --arg live "$LIVE_CURSOR" \
    --arg stale "$STALE_GAP" \
    --arg cself "$(cmd_for "$SELF")" \
    --arg clive "$(cmd_for "$LIVE_CURSOR")" \
    --arg cstale "$(cmd_for "$STALE_GAP")" \
    '[
        {pid:101, cmdline:$cself, environ:{HAPI_SESSION_ID:$self}, rss_kb:300000, etimes:100, start_marker:"m1"},
        {pid:102, cmdline:$clive, environ:{HAPI_SESSION_ID:$live}, rss_kb:310000, etimes:200, start_marker:"m2"},
        {pid:103, cmdline:$cstale, environ:{HAPI_SESSION_ID:$stale}, rss_kb:320000, etimes:900000, start_marker:"m3"}
    ]' >"$WORK/proc.json"
# resume tracks self+live only — stale is the ownership gap
jq -n \
    --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {requestedSessionId:$self, confirmedSessionId:$self, pid:101, processStartMarker:"m1"},
        {requestedSessionId:$live, confirmedSessionId:$live, pid:102, processStartMarker:"m2"}
    ]' >"$WORK/resume.json"

if out="$(run)"; then ok; else bad "clean gate should exit 0: $out"; fi
printf '%s' "$out" | grep -q "CONTROL $SELF" || bad "self control missing"
printf '%s' "$out" | grep -E "CONTROL $SELF .*rules=.*R4-active" >/dev/null \
    && ok || bad "self must show R4-active (not only R2): $out"
printf '%s' "$out" | grep -E "CONTROL $LIVE_CURSOR .*rules=.*R4-active" >/dev/null \
    && ok || bad "live cursor control must show R4-active: $out"
printf '%s' "$out" | grep -q "CANDIDATE pid=103" && ok || bad "stale gap should be candidate: $out"
printf '%s' "$out" | grep -q "GATE OK" && ok || bad "expected GATE OK: $out"

# --- 2. Gate must fail when a control would YES ---
# Make SELF look reclaimable: active=false, stale, untracked, bun-e
jq -n \
    --arg self "$SELF" \
    --argjson old "$((($(date +%s) - 20 * 86400) * 1000))" \
    --argjson now "$(($(date +%s) * 1000))" \
    --arg live "$LIVE_CURSOR" \
    --arg stale "$STALE_GAP" \
    --arg prot "$PROT_LIVE" \
    --arg husk "$SUPER_HUSK" \
    '{
        ($self): {id:$self, active:false, thinking:false, updatedAt:$old,
            metadata:{name:"bad self", flavor:"cursor", lifecycleState:"idle",
                cursorSessionId:"cur-self", path:"/tmp/self", startedBy:"runner"}},
        ($live): {id:$live, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"live cursor bune", flavor:"cursor", lifecycleState:"idle",
                cursorSessionId:"cur-live", path:"/tmp/live", startedBy:"runner"}},
        ($stale): {id:$stale, active:false, thinking:false, updatedAt:$old,
            metadata:{name:"stale gap", flavor:"cursor", lifecycleState:"idle",
                cursorSessionId:"cur-stale", path:"/tmp/stale", startedBy:"runner"}},
        ($prot): {id:$prot, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"tooling/meta bot", flavor:"claude", lifecycleState:"running"}},
        ($husk): {id:$husk, active:false, thinking:false, updatedAt:$old,
            metadata:{name:"SUPERSEDED husk", flavor:"cursor", lifecycleState:"archived",
                cursorSessionId:"cur-husk", path:"/tmp/husk"}}
    }' >"$WORK/sessions.json"
jq -n --arg self "$SELF" --arg cself "$(cmd_for "$SELF")" \
    --arg live "$LIVE_CURSOR" --arg clive "$(cmd_for "$LIVE_CURSOR")" \
    '[
        {pid:201, cmdline:$cself, environ:{HAPI_SESSION_ID:$self}, rss_kb:1000, etimes:999999, start_marker:null},
        {pid:202, cmdline:$clive, environ:{HAPI_SESSION_ID:$live}, rss_kb:1000, etimes:10, start_marker:"m2"}
    ]' >"$WORK/proc.json"
jq -n --arg live "$LIVE_CURSOR" \
    '[{requestedSessionId:$live, confirmedSessionId:$live, pid:202, processStartMarker:"m2"}]' \
    >"$WORK/resume.json"
if out="$(run)"; then
    bad "control-as-candidate must fail gate"
else
    ok
fi
printf '%s' "$out" | grep -q "would YES" && ok || bad "gate should mention control YES: $out"

# --- 3. Vacuous R2-only Cursor controls must fail the gate ---
# Only non-bune argv processes for cursor controls → R2-shape only
write_sessions
jq -n --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {pid:301, cmdline:("bun /x/cli/src/index.ts cursor --started-by runner --hapi-session-id "+$self),
         environ:{HAPI_SESSION_ID:$self}, rss_kb:1000, etimes:10, start_marker:null},
        {pid:302, cmdline:("bun /x/cli/src/index.ts cursor --started-by runner --hapi-session-id "+$live),
         environ:{HAPI_SESSION_ID:$live}, rss_kb:1000, etimes:10, start_marker:null}
    ]' >"$WORK/proc.json"
echo '[]' >"$WORK/resume.json"
if out="$(run)"; then
    # May still pass if R4-active is present on those controls — that is NON-vacuous.
    # Force flavor cursor with active true → R2 + R4. That should PASS the non-R2 requirement.
    # So instead: hub 404 for controls so only R2/R1 apply... use missing sessions.
    :
fi
# Rebuild: controls resolve but sessions fixture omits them → hub absent; only R2 if we
# strip environ sid so classify is R1+R2 only... Better: use --controls with bun-e
# shapes that are NOT active and NOT protect and NOT tracked and FRESH → fail R5 only
# actually we need ONLY R2. So non-bune cmdline + no hub row fields:
jq -n \
    --arg self "$SELF" --arg live "$LIVE_CURSOR" --arg prot "$PROT_LIVE" \
    --argjson now "$(($(date +%s) * 1000))" \
    '{
        ($prot): {id:$prot, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"tooling/meta bot", flavor:"claude", lifecycleState:"running"}}
    }' >"$WORK/sessions.json"
# self/live absent from hub → no R4; non-bune → R2; no environ → R1
jq -n --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {pid:401, cmdline:("node something "+$self), environ:{}, rss_kb:1, etimes:1},
        {pid:402, cmdline:("node something "+$live), environ:{}, rss_kb:1, etimes:1}
    ]' >"$WORK/proc.json"
if out="$(run)"; then
    bad "R2-only cursor controls must fail gate: $out"
else
    ok
fi
printf '%s' "$out" | grep -q "non-R2" && ok || bad "expected vacuous-gate message: $out"

# --- 4. Protected registry bun-e must show R6-protect ---
write_sessions
write_store
# husk is superseded non-404 → protect; give it bun-e untracked active=false stale
# (would be candidate but R6 blocks)
jq -n --arg husk "$SUPER_HUSK" --arg chusk "$(cmd_for "$SUPER_HUSK")" \
    --arg self "$SELF" --arg cself "$(cmd_for "$SELF")" \
    --arg live "$LIVE_CURSOR" --arg clive "$(cmd_for "$LIVE_CURSOR")" \
    '[
        {pid:501, cmdline:$chusk, environ:{HAPI_SESSION_ID:$husk}, rss_kb:400000, etimes:999999, start_marker:null},
        {pid:502, cmdline:$cself, environ:{HAPI_SESSION_ID:$self}, rss_kb:1000, etimes:10, start_marker:"m1"},
        {pid:503, cmdline:$clive, environ:{HAPI_SESSION_ID:$live}, rss_kb:1000, etimes:10, start_marker:"m2"}
    ]' >"$WORK/proc.json"
jq -n --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {requestedSessionId:$self, confirmedSessionId:$self, pid:502, processStartMarker:"m1"},
        {requestedSessionId:$live, confirmedSessionId:$live, pid:503, processStartMarker:"m2"}
    ]' >"$WORK/resume.json"
# extend controls to include husk for visibility; gate still uses self+live
if out="$("$SCRIPT" --config "$WORK/meta-sessions.yaml" --sessions-json "$WORK/sessions.json" \
    --proc-json "$WORK/proc.json" --resume-json "$WORK/resume.json" --store-json "$WORK/store.json" \
    --self "$SELF" --controls "$SELF,$LIVE_CURSOR,$SUPER_HUSK" --stale-days 7 2>&1)"; then
    ok
else
    bad "protect case should still gate-ok: $out"
fi
printf '%s' "$out" | grep -E "EXCLUDE pid=501 .*R6-protect" >/dev/null \
    && ok || bad "husk must be excluded by R6-protect: $out"
printf '%s' "$out" | grep -q "CANDIDATE pid=501" && bad "protected husk must not be candidate" || ok

# --- 5. Archive-alive must NOT alone create a candidate ---
# active=true archived annotation, untracked, old updatedAt — still R4-active
jq -n \
    --arg self "$SELF" --arg live "$LIVE_CURSOR" --arg arch "$STALE_GAP" \
    --arg prot "$PROT_LIVE" --arg husk "$SUPER_HUSK" \
    --argjson now "$(($(date +%s) * 1000))" \
    --argjson old "$((($(date +%s) - 20 * 86400) * 1000))" \
    '{
        ($self): {id:$self, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"self", flavor:"cursor", lifecycleState:"running", cursorSessionId:"cur-self", path:"/tmp/self"}},
        ($live): {id:$live, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"live", flavor:"cursor", lifecycleState:"idle", cursorSessionId:"cur-live", path:"/tmp/live"}},
        ($arch): {id:$arch, active:true, thinking:false, updatedAt:$old,
            metadata:{name:"archived but active", flavor:"cursor", lifecycleState:"archived",
                cursorSessionId:"cur-stale", path:"/tmp/stale"}},
        ($prot): {id:$prot, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"tooling/meta bot", flavor:"claude", lifecycleState:"running"}},
        ($husk): {id:$husk, active:false, thinking:false, updatedAt:$old,
            metadata:{name:"SUPERSEDED husk", flavor:"cursor", lifecycleState:"archived", cursorSessionId:"cur-husk"}}
    }' >"$WORK/sessions.json"
jq -n --arg arch "$STALE_GAP" --arg carch "$(cmd_for "$STALE_GAP")" \
    --arg self "$SELF" --arg cself "$(cmd_for "$SELF")" \
    --arg live "$LIVE_CURSOR" --arg clive "$(cmd_for "$LIVE_CURSOR")" \
    '[
        {pid:601, cmdline:$carch, environ:{HAPI_SESSION_ID:$arch}, rss_kb:1000, etimes:999999},
        {pid:602, cmdline:$cself, environ:{HAPI_SESSION_ID:$self}, rss_kb:1000, etimes:10, start_marker:"m1"},
        {pid:603, cmdline:$clive, environ:{HAPI_SESSION_ID:$live}, rss_kb:1000, etimes:10, start_marker:"m2"}
    ]' >"$WORK/proc.json"
jq -n --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {requestedSessionId:$self, confirmedSessionId:$self, pid:602, processStartMarker:"m1"},
        {requestedSessionId:$live, confirmedSessionId:$live, pid:603, processStartMarker:"m2"}
    ]' >"$WORK/resume.json"
if out="$(run)"; then ok; else bad "archive-alive fixture should gate-ok: $out"; fi
printf '%s' "$out" | grep -q "CANDIDATE pid=601" && bad "archive+active must not candidacy" || ok
printf '%s' "$out" | grep -E "EXCLUDE pid=601 .*R4-active" >/dev/null && ok || bad "archive-alive needs R4-active: $out"

# --- 6. Silent NO without rules is impossible (classifier always sets failed) ---
# Covered implicitly; assert EXCLUDE lines always have rules=
if out="$(run)"; then
    if printf '%s' "$out" | grep -E '^EXCLUDE ' | grep -v 'rules='; then
        bad "EXCLUDE line missing rules="
    else
        ok
    fi
fi

# --- 7. SINGLE-RULE-EXCLUDE surfaces load-bearing excludes ---
# Untracked, active=false, never_persisted store, but FRESH → only R5-fresh
write_sessions
write_store
jq -n \
    --arg self "$SELF" --arg live "$LIVE_CURSOR" --arg gap "$STALE_GAP" \
    --arg prot "$PROT_LIVE" --arg husk "$SUPER_HUSK" \
    --argjson now "$(($(date +%s) * 1000))" \
    --argjson old "$((($(date +%s) - 20 * 86400) * 1000))" \
    '{
        ($self): {id:$self, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"self", flavor:"cursor", lifecycleState:"running", cursorSessionId:"cur-self", path:"/tmp/self"}},
        ($live): {id:$live, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"live", flavor:"cursor", lifecycleState:"idle", cursorSessionId:"cur-live", path:"/tmp/live"}},
        ($gap): {id:$gap, active:false, thinking:false, updatedAt:$now,
            metadata:{name:"fresh idle inactive", flavor:"cursor", lifecycleState:"idle",
                cursorSessionId:"cur-stale", path:"/tmp/stale", startedBy:"runner"}},
        ($prot): {id:$prot, active:true, thinking:false, updatedAt:$now,
            metadata:{name:"tooling/meta bot", flavor:"claude", lifecycleState:"running"}},
        ($husk): {id:$husk, active:false, thinking:false, updatedAt:$old,
            metadata:{name:"SUPERSEDED husk", flavor:"cursor", lifecycleState:"archived", cursorSessionId:"cur-husk"}}
    }' >"$WORK/sessions.json"
jq -n --arg gap "$STALE_GAP" --arg cgap "$(cmd_for "$STALE_GAP")" \
    --arg self "$SELF" --arg cself "$(cmd_for "$SELF")" \
    --arg live "$LIVE_CURSOR" --arg clive "$(cmd_for "$LIVE_CURSOR")" \
    '[
        {pid:701, cmdline:$cgap, environ:{HAPI_SESSION_ID:$gap}, rss_kb:1000, etimes:10},
        {pid:702, cmdline:$cself, environ:{HAPI_SESSION_ID:$self}, rss_kb:1000, etimes:10, start_marker:"m1"},
        {pid:703, cmdline:$clive, environ:{HAPI_SESSION_ID:$live}, rss_kb:1000, etimes:10, start_marker:"m2"}
    ]' >"$WORK/proc.json"
jq -n --arg self "$SELF" --arg live "$LIVE_CURSOR" \
    '[
        {requestedSessionId:$self, confirmedSessionId:$self, pid:702, processStartMarker:"m1"},
        {requestedSessionId:$live, confirmedSessionId:$live, pid:703, processStartMarker:"m2"}
    ]' >"$WORK/resume.json"
if out="$(run)"; then ok; else bad "single-rule fixture should gate-ok: $out"; fi
printf '%s' "$out" | grep -E "SINGLE pid=701 .*rule=R5-fresh" >/dev/null \
    && ok || bad "expected SINGLE-RULE R5-fresh for pid 701: $out"
printf '%s' "$out" | grep -q "CANDIDATE pid=701" && bad "fresh inactive must not be candidate" || ok

echo "hapi-cursor-bune-ram-audit tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
