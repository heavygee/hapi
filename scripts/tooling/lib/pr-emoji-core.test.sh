#!/usr/bin/env bash
# Unit tests for pr-emoji-core (pure title + classify + ping-policy functions).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pr-emoji-core.sh
source "$LIB/pr-emoji-core.sh"

PASS=0
FAIL=0

eq() {
    local label="$1" got="$2" want="$3"
    if [[ "$got" == "$want" ]]; then
        PASS=$((PASS + 1))
        # echo "OK: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        echo "   want: [$want]" >&2
        echo "   got:  [$got]" >&2
    fi
}

emoji_of() {
    # decode "<emoji>\t<action>" → emoji
    printf '%s' "${1%%$'\t'*}"
}
action_of() {
    printf '%s' "${1#*$'\t'}"
}

# ---- title: strip leading emojis (incl. stacked + VS16) ----
eq "strip single ✅" "$(pec_strip_leading_emojis "✅PR #941: foo")" "PR #941: foo"
eq "strip stacked ⚠️✅" "$(pec_strip_leading_emojis "⚠️✅PR #941: foo")" "PR #941: foo"
eq "strip ⚠️ with VS16 + space" "$(pec_strip_leading_emojis "⚠️ PR #941: foo")" "PR #941: foo"
eq "strip 🔧" "$(pec_strip_leading_emojis "🔧PR #7: bar")" "PR #7: bar"
eq "no emoji unchanged" "$(pec_strip_leading_emojis "PR #941: foo")" "PR #941: foo"

# ---- title: extract PR numbers ----
eq "extract PR #941" "$(pec_extract_pr_numbers "✅PR #941: foo" | tr '\n' ',')" "941,"
eq "extract pr#923" "$(pec_extract_pr_numbers "pr#923 thing" | tr '\n' ',')" "923,"
eq "extract multi 941/923" "$(pec_extract_pr_numbers "PR #941/#923: foo" | tr '\n' ',')" "941,923,"
eq "extract Peer #1100" "$(pec_extract_pr_numbers "📝Peer #1100: incubating" | tr '\n' ',')" "1100,"
eq "extract PR: 941" "$(pec_extract_pr_numbers "PR: 941 stuff" | tr '\n' ',')" "941,"
# Scope protection: 1-2 digit internal workstream refs must NOT match (they would
# cross-wire overseer sessions to unrelated upstream PRs). See fn header.
eq "ignore two-digit #22 (overseer W1.6)" "$(pec_extract_pr_numbers "Peer: W1.6 provenance (#22)" | tr '\n' ',')" ""
eq "ignore two-digit PR #12" "$(pec_extract_pr_numbers "PR #12: small" | tr '\n' ',')" ""

# ---- title: build canonical titles ----
eq "build open PR" "$(pec_build_title "✅" 941 "✅PR #941: android watch" 0)" "✅PR #941: android watch"
eq "build pre-PR peer" "$(pec_build_title "📝" 1100 "📝Peer #1100: incubating" 1)" "📝Peer #1100: incubating"
eq "build renamed base" "$(pec_build_title "⚠️" 847 "🔁PR #847: codex usage" 0)" "⚠️PR #847: codex usage"

# ---- title: worst-emoji precedence ----
eq "worst ⚠️ vs ✅" "$(pec_worst_emoji "⚠️" "✅")" "⚠️"
eq "worst 🔁 vs 🔧" "$(pec_worst_emoji "🔁" "🔧")" "🔁"
eq "worst ? vs ⚠️" "$(pec_worst_emoji "?" "⚠️")" "?"
eq "worst ✅ vs 📝" "$(pec_worst_emoji "✅" "📝")" "✅"

eq "leading emoji ⚠️" "$(pec_leading_emoji "⚠️PR #1: x")" "⚠️"
eq "leading emoji none" "$(pec_leading_emoji "PR #1: x")" ""

# ---- decide_emoji: fixtures ----
# args: EXISTS MERGED CLOSED CHECKS_OK CHECKS_PENDING CHECKS_SEEN THREADS_N BOT_CLEAN BOT_MAJOR BOT_HAS_BODY MERGE_BAD DATA_UNAVAILABLE

r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 0 0 0 0)"
eq "all green → ✅" "$(emoji_of "$r")" "✅"

r="$(pec_decide_emoji 1 0 0 0 1 1 0 1 0 0 0 0)"
eq "checks pending → 🔁" "$(emoji_of "$r")" "🔁"

r="$(pec_decide_emoji 1 0 0 1 0 1 2 1 0 0 0 0)"
eq "2 threads → ⚠️" "$(emoji_of "$r")" "⚠️"
eq "2 threads action" "$(action_of "$r")" "resolve 2 open thread(s)"

r="$(pec_decide_emoji 1 0 0 0 0 1 0 0 1 1 0 0)"
eq "bot major → ⚠️" "$(emoji_of "$r")" "⚠️"

r="$(pec_decide_emoji 1 1 0 1 0 1 0 1 0 0 0 0)"
eq "merged → 🔧 (ignores checks)" "$(emoji_of "$r")" "🔧"

r="$(pec_decide_emoji 0 0 0 1 0 0 0 1 0 0 0 0)"
eq "no PR exists → 📝" "$(emoji_of "$r")" "📝"

r="$(pec_decide_emoji 1 0 1 1 0 1 0 1 0 0 0 0)"
eq "closed unmerged → ⚠️ (not green)" "$(emoji_of "$r")" "⚠️"

r="$(pec_decide_emoji 1 0 0 1 0 0 0 1 0 0 0 0)"
eq "no CI checks seen → NOT ✅" "$(emoji_of "$r")" "🔁"

r="$(pec_decide_emoji 1 0 0 1 0 1 -1 1 0 0 0 0)"
eq "green but thread count unavailable → 🔁" "$(emoji_of "$r")" "🔁"

r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 0 0 1 0)"
eq "merge dirty → ⚠️" "$(emoji_of "$r")" "⚠️"

r="$(pec_decide_emoji 0 0 0 0 0 0 0 0 0 0 0 1)"
eq "data unavailable → ? (not 📝)" "$(emoji_of "$r")" "?"

# ---- ping policy ----
FP_A="$(pec_action_fingerprint "⚠️" "fix failing CI")"
FP_B="$(pec_action_fingerprint "⚠️" "resolve 1 open thread(s)")"
eq "fingerprint deterministic" "$FP_A" "$(pec_action_fingerprint "⚠️" "fix failing CI")"
[[ "$FP_A" != "$FP_B" ]] && PASS=$((PASS + 1)) || { echo "FAIL: fingerprints should differ" >&2; FAIL=$((FAIL + 1)); }

eq "transition ✅→⚠️ pings" "$(pec_should_ping "⚠️" "✅" "$FP_A" "x" 100 200 86400)" "yes"
eq "sticky ⚠️ same fp, no reminder → no" "$(pec_should_ping "⚠️" "⚠️" "$FP_A" "$FP_A" 200 300 86400)" "no"
eq "sticky ⚠️ changed fp → yes" "$(pec_should_ping "⚠️" "⚠️" "$FP_B" "$FP_A" 200 300 86400)" "yes"
eq "sticky ⚠️ reminder elapsed → yes" "$(pec_should_ping "⚠️" "⚠️" "$FP_A" "$FP_A" 100 100000 86400)" "yes"
eq "sticky 🔧 same fp, no reminder → no" "$(pec_should_ping "🔧" "🔧" "$FP_A" "$FP_A" 200 300 86400)" "no"
eq "unchanged ✅ → no" "$(pec_should_ping "✅" "✅" "z" "z" 200 300 86400)" "no"
eq "unchanged 🔁 → no" "$(pec_should_ping "🔁" "🔁" "z" "z" 200 300 86400)" "no"
eq "unchanged 📝 → no" "$(pec_should_ping "📝" "📝" "z" "z" 200 300 86400)" "no"
eq "unknown ? → no" "$(pec_should_ping "?" "✅" "z" "z" 200 300 86400)" "no"
eq "first sight (no prev) ⚠️ → yes" "$(pec_should_ping "⚠️" "" "$FP_A" "" 0 300 86400)" "yes"
eq "first sight (no prev) ✅ → yes" "$(pec_should_ping "✅" "" "z" "" 0 300 86400)" "yes"

# ---- rename policy ----
eq "rename when title differs" "$(pec_should_rename "✅PR #1: x" "PR #1: x" "✅")" "yes"
eq "no rename when identical" "$(pec_should_rename "✅PR #1: x" "✅PR #1: x" "✅")" "no"
eq "never rename to ?" "$(pec_should_rename "?PR #1: x" "PR #1: x" "?")" "no"

# ---- emit policy / keys / body builder (slice B) ----
eq "emit reason: first ✅ is transition" \
    "$(pec_emit_reason "✅" "" "z" "" 0 300 86400)" "transition"
eq "emit reason: steady ✅ is none" \
    "$(pec_emit_reason "✅" "✅" "z" "z" 200 300 86400)" "none"
eq "emit reason: sticky ⚠️ reminder" \
    "$(pec_emit_reason "⚠️" "⚠️" "$FP_A" "$FP_A" 100 100000 86400)" "reminder"
eq "emit reason: sticky ⚠️ fp change" \
    "$(pec_emit_reason "⚠️" "⚠️" "$FP_B" "$FP_A" 200 300 86400)" "fingerprint"

eq "eventType ⚠️ → blocked" "$(pec_event_type_for_emoji "⚠️")" "blocked"
eq "eventType ✅ → progress" "$(pec_event_type_for_emoji "✅")" "progress"
eq "eventType 🔧 → completed" "$(pec_event_type_for_emoji "🔧")" "completed"
eq "eventType orphan-warn → needs_decision" "$(pec_event_type_for_emoji "⚠️" orphan)" "needs_decision"

eq "idempotency base key" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 999 "$FP_A")" \
    "contrib:tiann/hapi#999:$FP_A"
eq "idempotency reminder suffix" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 999 "$FP_A" reminder 2026-07-25)" \
    "contrib:tiann/hapi#999:$FP_A:reminder:2026-07-25"
eq "dedupe includes fingerprint" \
    "$(pec_contrib_dedupe_key "tiann/hapi" 999 blocked "$FP_A")" \
    "contrib:tiann/hapi#999:blocked:$FP_A"
eq "dedupe fingerprint change differs" \
    "$(pec_contrib_dedupe_key "tiann/hapi" 999 blocked "$FP_B")" \
    "contrib:tiann/hapi#999:blocked:$FP_B"
[[ "$(pec_contrib_dedupe_key "tiann/hapi" 999 blocked "$FP_A")" != \
   "$(pec_contrib_dedupe_key "tiann/hapi" 999 blocked "$FP_B")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: dedupe keys must differ across fingerprints" >&2; FAIL=$((FAIL + 1)); }
eq "dedupe reminder suffix keeps fingerprint" \
    "$(pec_contrib_dedupe_key "tiann/hapi" 999 blocked "$FP_A" reminder 2026-07-25)" \
    "contrib:tiann/hapi#999:blocked:$FP_A:reminder:2026-07-25"
eq "dedupe same eventType progress differs by fp" \
    "$(pec_contrib_dedupe_key "tiann/hapi" 999 progress "$FP_A")" \
    "contrib:tiann/hapi#999:progress:$FP_A"

# --- session-scoped keys (two sessions tracking one PR must not collide) ----
eq "idempotency session component appended" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" "" "" "3c141438")" \
    "contrib:tiann/hapi#947:$FP_A:sess:3c141438"
eq "dedupe session component appended" \
    "$(pec_contrib_dedupe_key "tiann/hapi" 947 progress "$FP_A" "" "" "3c141438")" \
    "contrib:tiann/hapi#947:progress:$FP_A:sess:3c141438"
[[ "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" "" "" "3c141438")" != \
   "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" "" "" "136df8b7")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: idempotency keys must differ across sessions" >&2; FAIL=$((FAIL + 1)); }
[[ "$(pec_contrib_dedupe_key "tiann/hapi" 947 progress "$FP_A" "" "" "3c141438")" != \
   "$(pec_contrib_dedupe_key "tiann/hapi" 947 progress "$FP_A" "" "" "136df8b7")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: dedupe keys must differ across sessions" >&2; FAIL=$((FAIL + 1)); }
eq "idempotency same session replay stable" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" "" "" "3c141438")" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" "" "" "3c141438")"
eq "orphan (no session) stays PR-scoped" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A")" \
    "contrib:tiann/hapi#947:$FP_A"
eq "session + reminder both suffixed" \
    "$(pec_contrib_idempotency_key "tiann/hapi" 947 "$FP_A" reminder 2026-07-25 "3c141438")" \
    "contrib:tiann/hapi#947:$FP_A:sess:3c141438:reminder:2026-07-25"

body="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 999 --emoji "✅" --action "full green — wait on tiann" \
    --fingerprint "$FP_A" --session-id "aaaaaaaa-1111" --reason transition \
    --date 2026-07-25)"
eq "body sourceKind channel" "$(jq -r '.sourceKind' <<<"$body")" "channel"
eq "body attentionCandidate 1 on ✅ transition" "$(jq -r '.attentionCandidate' <<<"$body")" "1"
eq "body relatedSessionId set" "$(jq -r '.relatedSessionId' <<<"$body")" "aaaaaaaa-1111"
eq "body artifact repo namespaced" "$(jq -r '.artifactRefs[0].repo' <<<"$body")" "tiann/hapi"
eq "body artifact number" "$(jq -r '.artifactRefs[0].number' <<<"$body")" "999"
eq "body never bare-number-only identity" "$(jq -r '.artifactRefs[0].number' <<<"$body")" "999"
eq "body dedupeKey embeds fingerprint + session" \
    "$(jq -r '.dedupeKey' <<<"$body")" \
    "contrib:tiann/hapi#999:progress:$FP_A:sess:aaaaaaaa-1111"
eq "body idempotencyKey embeds session" \
    "$(jq -r '.idempotencyKey' <<<"$body")" \
    "contrib:tiann/hapi#999:$FP_A:sess:aaaaaaaa-1111"
eq "body omits artifact title when --title not given" \
    "$(jq -r '.artifactRefs[0].title // "ABSENT"' <<<"$body")" "ABSENT"

body_titled="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 1215 --emoji "⚠️" --action "fix CI" \
    --fingerprint "$FP_A" --session-id "aaaaaaaa-1111" --reason transition \
    --date 2026-07-25 --title "feat(web): rich composer")"
eq "body carries artifact title when --title given" \
    "$(jq -r '.artifactRefs[0].title' <<<"$body_titled")" "feat(web): rich composer"

# Two sessions tracking the same PR + fingerprint → distinct body keys.
body_s1="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 947 --emoji "✅" --action "green" \
    --fingerprint "$FP_A" --session-id "3c141438" --reason transition --date 2026-07-25)"
body_s2="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 947 --emoji "✅" --action "green" \
    --fingerprint "$FP_A" --session-id "136df8b7" --reason transition --date 2026-07-25)"
[[ "$(jq -r '.idempotencyKey' <<<"$body_s1")" != "$(jq -r '.idempotencyKey' <<<"$body_s2")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: body idempotencyKeys must differ across sessions (same PR)" >&2; FAIL=$((FAIL + 1)); }
[[ "$(jq -r '.dedupeKey' <<<"$body_s1")" != "$(jq -r '.dedupeKey' <<<"$body_s2")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: body dedupeKeys must differ across sessions (same PR)" >&2; FAIL=$((FAIL + 1)); }

# Orphan body (no session) keeps PR-scoped keys (no :sess:).
body_orphan="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 947 --emoji "⚠️" --action "fix CI" \
    --fingerprint "$FP_A" --session-id "" --reason transition --date 2026-07-25)"
eq "orphan body idempotencyKey PR-scoped" \
    "$(jq -r '.idempotencyKey' <<<"$body_orphan")" \
    "contrib:tiann/hapi#947:$FP_A"

body_b="$(pec_build_channel_event_body \
    --repo tiann/hapi --number 999 --emoji "✅" --action "still green" \
    --fingerprint "$FP_B" --session-id "aaaaaaaa-1111" --reason fingerprint \
    --date 2026-07-25)"
[[ "$(jq -r '.dedupeKey' <<<"$body")" != "$(jq -r '.dedupeKey' <<<"$body_b")" ]] \
    && PASS=$((PASS + 1)) \
    || { echo "FAIL: body dedupeKeys must differ for fingerprint change" >&2; FAIL=$((FAIL + 1)); }

# --- dependency resolver (packaging boundary) -------------------------------
RES_TMP="$(mktemp -d)"
mkdir -p "$RES_TMP/samedir" "$RES_TMP/primary/scripts/tooling"
# explicit injection wins
eq "resolve: explicit injection highest priority" \
    "$(pec_resolve_tool "$RES_TMP/samedir" "$RES_TMP/primary" "/opt/x/hapi-pr-emoji-batch.sh" hapi-pr-emoji-batch.sh)" \
    "/opt/x/hapi-pr-emoji-batch.sh"
# same-dir present → same-dir
touch "$RES_TMP/samedir/hapi-pr-emoji-batch.sh"
eq "resolve: same-dir present used" \
    "$(pec_resolve_tool "$RES_TMP/samedir" "$RES_TMP/primary" "" hapi-pr-emoji-batch.sh)" \
    "$RES_TMP/samedir/hapi-pr-emoji-batch.sh"
# same-dir absent + canonical present → canonical
touch "$RES_TMP/primary/scripts/tooling/hapi-ping-peer.sh"
eq "resolve: same-dir absent falls back to canonical" \
    "$(pec_resolve_tool "$RES_TMP/samedir" "$RES_TMP/primary" "" hapi-ping-peer.sh)" \
    "$RES_TMP/primary/scripts/tooling/hapi-ping-peer.sh"
rm -rf "$RES_TMP"

echo ""
echo "pr-emoji-core.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
