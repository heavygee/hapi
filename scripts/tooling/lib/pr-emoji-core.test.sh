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

# ---- title: strip PR #N: once chip owns identity ----
eq "strip PR #941:" "$(pec_strip_pr_number_prefixes "PR #941: android watch")" "android watch"
eq "strip emoji then PR" "$(pec_strip_pr_number_prefixes "✅PR #941: android watch")" "android watch"
eq "strip multi PR #941/#923:" "$(pec_strip_pr_number_prefixes "PR #941/#923: stacked")" "stacked"
eq "strip pr#923:" "$(pec_strip_pr_number_prefixes "pr#923: thing")" "thing"
eq "keep Peer #1100:" "$(pec_strip_pr_number_prefixes "Peer #1100: incubating")" "Peer #1100: incubating"
eq "strip PR leave Peer suffix" "$(pec_strip_pr_number_prefixes "PR #1087: Peer #1085: banner")" "Peer #1085: banner"
eq "workstream-only unchanged" "$(pec_strip_pr_number_prefixes "opt-in awareness")" "opt-in awareness"

# ---- title: extract PR numbers ----
eq "extract PR #941" "$(pec_extract_pr_numbers "✅PR #941: foo" | tr '\n' ',')" "941,"
eq "extract pr#923" "$(pec_extract_pr_numbers "pr#923 thing" | tr '\n' ',')" "923,"
eq "extract multi 941/923" "$(pec_extract_pr_numbers "PR #941/#923: foo" | tr '\n' ',')" "941,923,"
eq "extract Peer #1100" "$(pec_extract_pr_numbers "📝Peer #1100: incubating" | tr '\n' ',')" "1100,"
eq "extract PR: 941" "$(pec_extract_pr_numbers "PR: 941 stuff" | tr '\n' ',')" "941,"
# HARD: bare #NNN must NEVER route Meta (Sparling "Module 02 … #395" incident 2026-08-06)
eq "bare #395 Module title → empty" "$(pec_extract_pr_numbers "Module 02: support case schema #395" | tr '\n' ',')" ""
eq "bare #1085 alone → empty" "$(pec_extract_pr_numbers "Dogfood: #1085 hang" | tr '\n' ',')" ""

# Linked-PR extractor (chip backfill): Peer / bare # must not become PR chips
eq "linked ignores Peer #1100" "$(pec_extract_linked_pr_numbers "📝Peer #1100: incubating" | tr '\n' ',')" ""
eq "linked ignores bare #1085 in Peer title" "$(pec_extract_linked_pr_numbers "Peer #1085: Dogfood: #1085 hang" | tr '\n' ',')" ""
eq "linked keeps PR #1087 when Peer also present" "$(pec_extract_linked_pr_numbers "PR #1087: Peer #1085: banner" | tr '\n' ',')" "1087,"
eq "linked extract PR #941" "$(pec_extract_linked_pr_numbers "✅PR #941: foo" | tr '\n' ',')" "941,"
# No-match must exit 0 — pipefail in hapi-meta-daily aborts on grep/[[ status 1.
eq "extract no-match exit 0" "$(set -euo pipefail; pec_extract_pr_numbers "session external_refs + PR chip"; echo OK)" "OK"
eq "linked no-match exit 0" "$(set -euo pipefail; pec_extract_linked_pr_numbers "opt-in awareness"; echo OK)" "OK"
# Scope protection: 1-2 digit internal workstream refs must NOT match (they would
# cross-wire overseer sessions to unrelated upstream PRs). See fn header.
eq "ignore two-digit #22 (overseer W1.6)" "$(pec_extract_pr_numbers "Peer: W1.6 provenance (#22)" | tr '\n' ',')" ""
eq "ignore two-digit PR #12" "$(pec_extract_pr_numbers "PR #12: small" | tr '\n' ',')" ""

# ---- estate path gate ----
eq "path hapi mirror" "$(pec_path_is_hapi_estate "/home/x/coding/hapi" && echo yes)" "yes"
eq "path hapi worktree" "$(pec_path_is_hapi_estate "/home/x/coding/hapi/worktrees/foo" && echo yes)" "yes"
eq "path sparling refuse" "$(pec_path_is_hapi_estate "/home/x/coding/sparling" && echo yes || echo no)" "no"
eq "path empty refuse" "$(pec_path_is_hapi_estate "" && echo yes || echo no)" "no"

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

# Sticky body-grep [Major] after threads resolved, while new pr-review/CI still
# pending, must not force ⚠️ (dogfood #1205 / session 20b195f3).
r="$(pec_decide_emoji 1 0 0 0 1 1 0 0 1 1 0 0)"
eq "pending CI + threads=0 + sticky bot_major → 🔁" "$(emoji_of "$r")" "🔁"
[[ "$(action_of "$r")" == *"CI running"* ]] && PASS=$((PASS + 1)) \
    || { echo "FAIL: pending+sticky-major action should mention CI running (got: $(action_of "$r"))" >&2; FAIL=$((FAIL + 1)); }

r="$(pec_decide_emoji 1 0 0 1 0 1 2 1 0 0 0 0)"
eq "2 threads → ⚠️" "$(emoji_of "$r")" "⚠️"
eq "2 threads action" "$(action_of "$r")" "resolve 2 open thread(s)"

r="$(pec_decide_emoji 1 0 0 0 0 1 0 0 1 1 0 0)"
eq "bot major → ⚠️" "$(emoji_of "$r")" "⚠️"

r="$(pec_decide_emoji 1 1 0 1 0 1 0 1 0 0 0 0)"
eq "merged → 🔧 (ignores checks)" "$(emoji_of "$r")" "🔧"
[[ "$(action_of "$r")" == *"exit reflection"* ]] && PASS=$((PASS + 1)) \
    || { echo "FAIL: merged action should mention exit reflection (got: $(action_of "$r"))" >&2; FAIL=$((FAIL + 1)); }

r="$(pec_decide_emoji 0 0 0 1 0 0 0 1 0 0 0 0)"
eq "no PR exists → 📝" "$(emoji_of "$r")" "📝"

r="$(pec_decide_emoji 1 0 1 1 0 1 0 1 0 0 0 0)"
eq "closed unmerged → ⚠️ (not green)" "$(emoji_of "$r")" "⚠️"
eq "closed unmerged mentions superseded exit" "$(action_of "$r" | grep -c 'retarget chip to absorber')" "1"

r="$(pec_decide_emoji 1 0 1 0 0 0 0 0 0 0 0 0 0 1)"
eq "closed superseded hint → ⚠️" "$(emoji_of "$r")" "⚠️"
eq "closed superseded hint action" "$(action_of "$r" | grep -c 'closed superseded')" "1"

r="$(pec_decide_emoji 1 0 0 1 0 0 0 1 0 0 0 0)"
eq "no CI checks seen → NOT ✅" "$(emoji_of "$r")" "🔁"

r="$(pec_decide_emoji 1 0 0 1 0 1 -1 1 0 0 0 0)"
eq "green but thread count unavailable → 🔁" "$(emoji_of "$r")" "🔁"

r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 0 0 1 0)"
eq "merge dirty → ⚠️" "$(emoji_of "$r")" "⚠️"

r="$(pec_decide_emoji 0 0 0 0 0 0 0 0 0 0 0 1)"
eq "data unavailable → ? (not 📝)" "$(emoji_of "$r")" "?"

# Green path must NOT ignore bot_major when bot_clean is wrongly 1
# (Questions "- None." used to set bot_clean while Findings had [Major]).
r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 1 1 0 0)"
eq "checks green + bot_clean + bot_major → ⚠️ not ✅" "$(emoji_of "$r")" "⚠️"
[[ "$(action_of "$r")" == *"[Major]"* ]] && PASS=$((PASS + 1)) \
    || { echo "FAIL: green+major action should mention [Major] (got: $(action_of "$r"))" >&2; FAIL=$((FAIL + 1)); }

# Open threads block green even when CI/bot look clean.
r="$(pec_decide_emoji 1 0 0 1 0 1 2 1 0 0 0 0)"
eq "checks green + 2 threads → ⚠️" "$(emoji_of "$r")" "⚠️"

# Formal CHANGES_REQUESTED blocks green (optional 13th arg).
r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 0 0 0 0 1)"
eq "checks green + CHANGES_REQUESTED → ⚠️" "$(emoji_of "$r")" "⚠️"
[[ "$(action_of "$r")" == *"CHANGES_REQUESTED"* ]] && PASS=$((PASS + 1)) \
    || { echo "FAIL: CHANGES_REQUESTED action missing (got: $(action_of "$r"))" >&2; FAIL=$((FAIL + 1)); }

# CHANGES_REQUESTED is never sticky-suppressed while CI pending.
r="$(pec_decide_emoji 1 0 0 0 1 1 0 0 0 1 0 0 1)"
eq "pending CI + CHANGES_REQUESTED → ⚠️" "$(emoji_of "$r")" "⚠️"

# ---- chip thread counting: exclude outdated (#847 false ⚠️) ----
# Findings:None + CI green + 1 outdated unresolved bot Major → count 0 → ✅
eq "outdated unresolved alone → 0" \
    "$(pec_count_chip_unresolved_threads '[{"isResolved":false,"isOutdated":true}]')" "0"
eq "current unresolved still counts" \
    "$(pec_count_chip_unresolved_threads '[{"isResolved":false,"isOutdated":false},{"isResolved":false,"isOutdated":true}]')" "1"
eq "resolved current ignored" \
    "$(pec_count_chip_unresolved_threads '[{"isResolved":true,"isOutdated":false}]')" "0"
# #847 end-to-end: after filtering, threads_n=0 + botClean + CI green → ✅
r="$(pec_decide_emoji 1 0 0 1 0 1 0 1 0 0 0 0)"
eq "#847 fixture: Findings:None + CI green + outdated-only threads → ✅" "$(emoji_of "$r")" "✅"

# ---- ping policy ----
FP_A="$(pec_action_fingerprint "⚠️" "fix failing CI")"
FP_B="$(pec_action_fingerprint "⚠️" "resolve 1 open thread(s)")"
eq "fingerprint deterministic" "$FP_A" "$(pec_action_fingerprint "⚠️" "fix failing CI")"
[[ "$FP_A" != "$FP_B" ]] && PASS=$((PASS + 1)) || { echo "FAIL: fingerprints should differ" >&2; FAIL=$((FAIL + 1)); }

eq "transition ✅→⚠️ pings" "$(pec_should_ping "⚠️" "✅" "$FP_A" "x" 100 200 86400)" "yes"
eq "sticky ⚠️ same fp, no reminder → no" "$(pec_should_ping "⚠️" "⚠️" "$FP_A" "$FP_A" 200 300 86400)" "no"
eq "sticky ⚠️ window rouse → yes" "$(pec_should_ping "⚠️" "⚠️" "$FP_A" "$FP_A" 200 300 86400 1)" "yes"
eq "sticky 🔧 window rouse → yes" "$(pec_should_ping "🔧" "🔧" "$FP_A" "$FP_A" 200 300 86400 1)" "yes"
eq "unchanged ✅ window rouse still no" "$(pec_should_ping "✅" "✅" "z" "z" 200 300 86400 1)" "no"
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
eq "emit reason: sticky ⚠️ window" \
    "$(pec_emit_reason "⚠️" "⚠️" "$FP_A" "$FP_A" 200 300 86400 1)" "window"
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
    --repo tiann/hapi --number 999 --emoji "✅" --action "full green - wait on tiann" \
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

# ---- bot findings body (#1400 HAPI Bot "None at the current head") ----
_clean_body_none_at_head='**Findings**
- None at the current head.

**Summary**
- Residual risk: coverage remains helper-level.

**Testing**
- Suggested: add a component-level test.
'
_clean_body_none_dot='**Findings**
- None.

**Summary**
- No issues found.
'
_dirty_body_major='**Findings**
- [Major] Something broke.

**Summary**
- One major.
'
if pec_bot_body_findings_clean "$_clean_body_none_at_head"; then
    eq "findings clean: None at the current head" "yes" "yes"
else
    eq "findings clean: None at the current head" "no" "yes"
fi
if pec_bot_body_findings_clean "$_clean_body_none_dot"; then
    eq "findings clean: - None." "yes" "yes"
else
    eq "findings clean: - None." "no" "yes"
fi
if pec_bot_body_findings_clean "$_dirty_body_major"; then
    eq "findings dirty: Major" "yes" "no"
else
    eq "findings dirty: Major" "no" "no"
fi

eq "status_from_emoji clean" "$(pec_status_from_emoji '✅')" "clean"
eq "status_from_emoji needs_work" "$(pec_status_from_emoji '⚠️')" "needs_work"
eq "status_from_emoji unknown" "$(pec_status_from_emoji '?')" "unknown"
eq "emoji_from_status merged" "$(pec_emoji_from_status merged)" "🔧"
eq "status_from_emoji complete" "$(pec_status_from_emoji '🧹')" "complete"
eq "emoji_from_status complete" "$(pec_emoji_from_status complete)" "🧹"
eq "estate complete" "$(pec_estate_code_from_emoji '🧹')" "babysit.complete"
eq "worst 🔧 vs 🧹" "$(pec_worst_emoji "🔧" "🧹")" "🔧"
eq "strip 🧹" "$(pec_strip_leading_emojis "🧹PR #941: foo")" "PR #941: foo"

# complete never pings (incl. transition from 🔧)
eq "ping never on complete" "$(pec_should_ping "🧹" "🔧" "a" "b" 0 100 10 1 || true)" "no"
eq "ping sticky 🔧 on window" "$(pec_should_ping "🔧" "🔧" "a" "a" 0 100 10 1 || true)" "yes"
eq "emit none on complete" "$(pec_emit_reason "🧹" "🔧" "a" "b" 0 100 10 1 || true)" "none"

echo ""
echo "pr-emoji-core.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
