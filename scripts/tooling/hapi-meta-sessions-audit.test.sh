#!/usr/bin/env bash
# hapi-meta-sessions-audit — drift detection cases.
# A green-only auditor proves nothing; every check here must also go red.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/hapi-meta-sessions-audit.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LIVE='11111111-1111-1111-1111-111111111111'
HUSK='22222222-2222-2222-2222-222222222222'
GONE='33333333-3333-3333-3333-333333333333'

write_config() {  # $1 = live id, $2 = superseded id
    cat >"$WORK/meta-sessions.yaml" <<EOF
schema: 1
sessions:
  pr_watcher:
    name: meta - PR watcher
    id: $1
    env: HAPI_META_SESSION_ID
    superseded: $2
EOF
}

write_sessions() {  # $1 = husk title
    jq -n --arg live "$LIVE" --arg husk "$HUSK" --arg ht "$1" \
        '{sessions:[
            {id:$live, metadata:{name:"meta - PR watcher"}},
            {id:$husk, metadata:{name:$ht}}
        ]}' >"$WORK/sessions.json"
}

write_env() {  # $1 = env value
    printf 'HAPI_META_SESSION_ID=%s\n' "$1" >"$WORK/meta-daily.env"
}

run() {
    "$SCRIPT" --config "$WORK/meta-sessions.yaml" \
        --env-file "$WORK/meta-daily.env" \
        --sessions-json "$WORK/sessions.json" 2>&1
}

# 1. Everything agrees → clean, exit 0.
write_config "$LIVE" "$HUSK"
write_sessions "SUPERSEDED meta - PR watcher (Cursor) — use Claude 1111"
write_env "$LIVE"
if out="$(run)"; then ok; else bad "clean registry should exit 0: $out"; fi
if printf '%s' "$out" | grep -q "registry clean"; then ok; else bad "no clean summary ($out)"; fi

# 2. The real 2026-11-08 bug: husk still wearing the live title.
write_sessions "meta - PR watcher"
if out="$(run)"; then
    bad "husk wearing live title must fail"
else
    ok
fi
if printf '%s' "$out" | grep -q "collides with live"; then ok; else bad "no collision drift line ($out)"; fi

# 3. Archived husk is absent from the hub → stronger than retitled, still clean.
write_config "$LIVE" "$GONE"
write_sessions "SUPERSEDED whatever"
if out="$(run)"; then ok; else bad "absent husk should pass: $out"; fi
if printf '%s' "$out" | grep -q "absent from hub"; then ok; else bad "no archived note ($out)"; fi

# 4. Env pointer disagrees with the registry.
write_config "$LIVE" "$HUSK"
write_sessions "SUPERSEDED x"
write_env "$GONE"
if out="$(run)"; then bad "env mismatch must fail"; else ok; fi
if printf '%s' "$out" | grep -q "HAPI_META_SESSION_ID=33333333"; then ok; else bad "no env drift line ($out)"; fi

# 5. Live session missing from the hub entirely.
write_config "$GONE" "$HUSK"
write_env "$GONE"
if out="$(run)"; then bad "missing live session must fail"; else ok; fi
if printf '%s' "$out" | grep -q "not found on hub"; then ok; else bad "no missing-live line ($out)"; fi

# 6. Live session present but retitled out from under the registry.
write_config "$LIVE" "$HUSK"
write_env "$LIVE"
jq -n --arg live "$LIVE" --arg husk "$HUSK" \
    '{sessions:[
        {id:$live, metadata:{name:"meta - PR watcher ✅"}},
        {id:$husk, metadata:{name:"SUPERSEDED x"}}
    ]}' >"$WORK/sessions.json"
if out="$(run)"; then bad "retitled live session must fail (ADR D8 emoji drift)"; else ok; fi
if printf '%s' "$out" | grep -q "!= registry name"; then ok; else bad "no title drift line ($out)"; fi

echo "hapi-meta-sessions-audit tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
