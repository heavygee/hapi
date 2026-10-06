#!/usr/bin/env bash
# Unit tests for pr-hold-core (identity latch; no NLP; bots never hold).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pr-emoji-core.sh
source "$LIB/pr-emoji-core.sh"
# shellcheck source=pr-hold-core.sh
source "$LIB/pr-hold-core.sh"

PASS=0
FAIL=0

eq() {
    local label="$1" got="$2" want="$3"
    if [[ "$got" == "$want" ]]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        echo "   want: [$want]" >&2
        echo "   got:  [$got]" >&2
    fi
}

# ---- bot kill-criterion --------------------------------------------------
eq "github-actions type Bot refused" \
    "$(pec_hold_actor_ok "github-actions[bot]" "Bot" && echo yes || echo no)" "no"
eq "github-actions login refused even if type User" \
    "$(pec_hold_actor_ok "github-actions" "User" && echo yes || echo no)" "no"
eq "dependabot refused" \
    "$(pec_hold_actor_ok "dependabot[bot]" "Bot" && echo yes || echo no)" "no"
eq "codex bot login refused" \
    "$(pec_hold_actor_ok "chatgpt-codex-connector[bot]" "Bot" && echo yes || echo no)" "no"
eq "[bot] suffix refused" \
    "$(pec_hold_actor_ok "hapi-bot[bot]" "User" && echo yes || echo no)" "no"
eq "human tiann type User allowed" \
    "$(pec_hold_actor_ok "tiann" "User" && echo yes || echo no)" "yes"

# ---- hold logins ---------------------------------------------------------
eq "default logins include tiann" "$(pec_hold_logins_csv "" "" | tr ',' '\n' | grep -cx 'tiann')" "1"
eq "env overrides" "$(pec_hold_logins_csv "heavygee,tiann" "" )" "heavygee,tiann"
eq "login allowlist hit" \
    "$(pec_hold_login_allowed "tiann" "tiann,heavygee" && echo yes || echo no)" "yes"
eq "login allowlist miss" \
    "$(pec_hold_login_allowed "octocat" "tiann" && echo yes || echo no)" "no"
eq "login case-insensitive" \
    "$(pec_hold_login_allowed "Tiann" "tiann" && echo yes || echo no)" "yes"

# ---- surfaces ------------------------------------------------------------
eq "issue_comment is hold surface" \
    "$(pec_hold_surface_ok "issue_comment" && echo yes || echo no)" "yes"
eq "review_body is hold surface" \
    "$(pec_hold_surface_ok "review_body" && echo yes || echo no)" "yes"
eq "inline review_comment is NOT hold surface" \
    "$(pec_hold_surface_ok "review_comment" && echo yes || echo no)" "no"
eq "empty review body is NOT hold surface" \
    "$(pec_hold_surface_ok "review_body" "" && echo yes || echo no)" "no"
eq "whitespace review body is NOT hold surface" \
    "$(pec_hold_surface_ok "review_body" "   " && echo yes || echo no)" "no"
eq "review body with text is hold surface" \
    "$(pec_hold_surface_ok "review_body" "please trim the upgrade stack" && echo yes || echo no)" "yes"

# ---- should latch (all gates) --------------------------------------------
eq "tiann issue comment latches" \
    "$(pec_hold_should_latch "issue_comment" "tiann" "User" "please trim" "tiann" && echo yes || echo no)" "yes"
eq "bot Findings never latch" \
    "$(pec_hold_should_latch "issue_comment" "github-actions[bot]" "Bot" "**Findings**" "tiann" && echo yes || echo no)" "no"
eq "inline review comment never latch even from tiann" \
    "$(pec_hold_should_latch "review_comment" "tiann" "User" "nit: rename" "tiann" && echo yes || echo no)" "no"
eq "human not on allowlist never latch" \
    "$(pec_hold_should_latch "issue_comment" "octocat" "User" "lgtm" "tiann" && echo yes || echo no)" "no"
eq "tiann review body latches" \
    "$(pec_hold_should_latch "review_body" "tiann" "User" "drop the fleet upgrade" "tiann" && echo yes || echo no)" "yes"
eq "tiann thanks still latches (no NLP)" \
    "$(pec_hold_should_latch "issue_comment" "tiann" "User" "thanks" "tiann" && echo yes || echo no)" "yes"

# ---- fingerprint + ack overlay -------------------------------------------
HOLD_JSON='{"repo":"tiann/hapi","pr":"1108","surface":"issue_comment","comment_id":"5154418101","author":"tiann","url":"https://github.com/tiann/hapi/pull/1108#issuecomment-5154418101","excerpt":"please trim","acked":false,"created_at":"2026-08-02T01:26:00Z"}'
eq "fingerprint stable" \
    "$(pec_hold_fingerprint "tiann/hapi" "1108" "issue_comment" "5154418101")" \
    "tiann/hapi#1108:issue_comment:5154418101"

# jq treats # as a comment in object literals — always pass the key via --arg.
STATE_UNACKED="$(jq -cn --argjson h "$HOLD_JSON" --arg k "tiann/hapi#1108" '{hold:{($k):$h}}')"
STATE_ACKED="$(jq -c --arg k "tiann/hapi#1108" '.hold[$k].acked=true' <<<"$STATE_UNACKED")"

eq "unacked hold overlays 🛑" \
    "$(pec_hold_overlay_emoji "✅" "$STATE_UNACKED" "tiann/hapi" "1108")" "🛑"
eq "acked hold returns live emoji" \
    "$(pec_hold_overlay_emoji "✅" "$STATE_ACKED" "tiann/hapi" "1108")" "✅"
eq "no hold row returns live emoji" \
    "$(pec_hold_overlay_emoji "⚠️" '{"hold":{}}' "tiann/hapi" "999")" "⚠️"

# same fingerprint already latched → not a new latch
eq "same fingerprint already latched is not new" \
    "$(pec_hold_is_new_latch "$STATE_UNACKED" "tiann/hapi" "1108" "issue_comment" "5154418101" && echo yes || echo no)" "no"
eq "different comment id is new latch" \
    "$(pec_hold_is_new_latch "$STATE_UNACKED" "tiann/hapi" "1108" "issue_comment" "5154418199" "2026-08-03T00:00:00Z" && echo yes || echo no)" "yes"
eq "acked fingerprint can re-latch on new comment" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "issue_comment" "5154418199" "2026-08-03T00:00:00Z" && echo yes || echo no)" "yes"
eq "acked same comment id is not a new latch" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "issue_comment" "5154418101" && echo yes || echo no)" "no"
eq "older event after ack is not a new latch" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "issue_comment" "100" "2026-08-01T00:00:00Z" && echo yes || echo no)" "no"
eq "later issue comment with smaller id than stored review still latches" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "issue_comment" "99" "2026-08-04T00:00:00Z" && echo yes || echo no)" "yes"
eq "equal timestamp different id while unacked is not new" \
    "$(pec_hold_is_new_latch "$STATE_UNACKED" "tiann/hapi" "1108" "issue_comment" "5154418999" "2026-08-02T01:26:00Z" && echo yes || echo no)" "no"
eq "equal timestamp different id after ack is new latch" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "issue_comment" "5154418999" "2026-08-02T01:26:00Z" && echo yes || echo no)" "yes"
eq "same numeric id different surface after ack is new latch" \
    "$(pec_hold_is_new_latch "$STATE_ACKED" "tiann/hapi" "1108" "review_body" "5154418101" "2026-08-03T00:00:00Z" && echo yes || echo no)" "yes"
eq "same numeric id different surface later while unacked is new latch" \
    "$(pec_hold_is_new_latch "$STATE_UNACKED" "tiann/hapi" "1108" "review_body" "5154418101" "2026-08-03T00:00:00Z" && echo yes || echo no)" "yes"

ACKED2="$(pec_hold_ack_state "$STATE_UNACKED" "tiann/hapi" "1108")"
eq "ack sets acked true" \
    "$(jq -r '.hold["tiann/hapi#1108"].acked' <<<"$ACKED2")" "true"
eq "ack records fingerprint in acked_fps" \
    "$(jq -r '.hold["tiann/hapi#1108"].acked_fps[]' <<<"$ACKED2" | grep -c '5154418101')" "1"
eq "ack overlay after ack_state is live" \
    "$(pec_hold_overlay_emoji "⚠️" "$ACKED2" "tiann/hapi" "1108")" "⚠️"

# Equal-time A↔B must not oscillate after both fingerprints are acknowledged.
SIBLING_TS="2026-08-02T01:26:00Z"
AFTER_A="$ACKED2"
# Sibling B at equal ts latches once A is acked
eq "sibling B equal-ts latches after A ack" \
    "$(pec_hold_is_new_latch "$AFTER_A" "tiann/hapi" "1108" "issue_comment" "5154418999" "$SIBLING_TS" && echo yes || echo no)" "yes"
AFTER_B="$(pec_hold_upsert_state "$AFTER_A" "tiann/hapi" "1108" "issue_comment" "5154418999" "tiann" \
    "https://github.com/tiann/hapi/pull/1108#issuecomment-5154418999" "also trim" "$SIBLING_TS")"
eq "upsert B preserves A's acked_fps" \
    "$(jq -r '.hold["tiann/hapi#1108"].acked_fps[]' <<<"$AFTER_B" | grep -c '5154418101')" "1"
AFTER_B_ACK="$(pec_hold_ack_state "$AFTER_B" "tiann/hapi" "1108")"
eq "ack B records both fingerprints" \
    "$(jq -r '.hold["tiann/hapi#1108"].acked_fps | length' <<<"$AFTER_B_ACK")" "2"
eq "after both acked, A equal-ts does not re-latch" \
    "$(pec_hold_is_new_latch "$AFTER_B_ACK" "tiann/hapi" "1108" "issue_comment" "5154418101" "$SIBLING_TS" && echo yes || echo no)" "no"
eq "after both acked, B equal-ts does not re-latch" \
    "$(pec_hold_is_new_latch "$AFTER_B_ACK" "tiann/hapi" "1108" "issue_comment" "5154418999" "$SIBLING_TS" && echo yes || echo no)" "no"
eq "later comment still latches after equal-ts siblings acked" \
    "$(pec_hold_is_new_latch "$AFTER_B_ACK" "tiann/hapi" "1108" "issue_comment" "999999" "2026-08-05T00:00:00Z" && echo yes || echo no)" "yes"

# excerpt trim to 140
LONG="$(printf 'x%.0s' {1..200})"
eq "excerpt caps at 140" \
    "$(pec_hold_excerpt "$LONG" | wc -c | tr -d ' ')" "140"

# upsert must emit valid JSON (jq object-value `and` is a parse error)
UPSERT="$(pec_hold_upsert_state '{}' "tiann/hapi" "100" "issue_comment" "5154418101" "tiann" \
    "https://github.com/tiann/hapi/pull/100#issuecomment-5154418101" "please trim" \
    "2026-08-02T01:26:00Z")"
eq "upsert emits JSON" "$(printf '%s' "$UPSERT" | jq -e . >/dev/null && echo yes || echo no)" "yes"
eq "upsert stores created_at" "$(printf '%s' "$UPSERT" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].created_at')" "2026-08-02T01:26:00Z"
eq "upsert stores surface" "$(printf '%s' "$UPSERT" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].surface')" "issue_comment"
eq "upsert acked false" "$(printf '%s' "$UPSERT" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].acked')" "false"
eq "upsert notified false on new fp" "$(printf '%s' "$UPSERT" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].notified')" "false"
eq "upsert overlay is hold" "$(pec_hold_overlay_emoji "⚠️" "$UPSERT" "tiann/hapi" "100")" "🛑"
MARKED="$(pec_hold_mark_notified "$UPSERT" "tiann/hapi" "100")"
SAME_FP="$(pec_hold_upsert_state "$MARKED" "tiann/hapi" "100" "issue_comment" "5154418101" "tiann" \
    "https://github.com/tiann/hapi/pull/100#issuecomment-5154418101" "please trim")"
eq "upsert same fp keeps notified" "$(printf '%s' "$SAME_FP" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].notified')" "true"
NEW_FP="$(pec_hold_upsert_state "$MARKED" "tiann/hapi" "100" "issue_comment" "999" "tiann" \
    "https://github.com/tiann/hapi/pull/100#issuecomment-999" "new cut")"
eq "upsert new fp resets notified" "$(printf '%s' "$NEW_FP" | jq -r --arg k 'tiann/hapi#100' '.hold[$k].notified')" "false"

echo ""
echo "pr-hold-core.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
