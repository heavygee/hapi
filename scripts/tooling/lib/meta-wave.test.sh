#!/usr/bin/env bash
# Unit tests for meta-wave.sh (gate A wave-clear helpers).
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=meta-wave.sh
source "$LIB/meta-wave.sh"

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
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

MANIFEST_ACTIVE=$(cat <<'EOF'
base: upstream/main
layers:
  # Drop when upstream #896 merges. Worktree: agent-import-picker
  - branch: feat/agent-session-import-picker

  # DROPPED 2026-07-24: merged as #1144
  # - branch: feat/session-copy-link

  - pr: 945
EOF
)

MANIFEST_CLEAN=$(cat <<'EOF'
base: upstream/main
layers:
  # DROPPED 2026-07-29: feat/foo MERGED as #896
  # - branch: feat/foo
EOF
)

# --- manifest layer attribution ---
if mw_manifest_pr_layer_active "$MANIFEST_ACTIVE" 896; then ok; else bad "896 active via comment block"; fi
if mw_manifest_pr_layer_active "$MANIFEST_ACTIVE" 945; then ok; else bad "945 active via - pr:"; fi
if mw_manifest_pr_layer_active "$MANIFEST_ACTIVE" 1144; then bad "1144 DROPPED should be clean"; else ok; fi
if mw_manifest_pr_layer_active "$MANIFEST_CLEAN" 896; then bad "896 dropped should be clean"; else ok; fi

# Incidental compound "#1195/#896" on another layer must NOT attribute 896
MANIFEST_INCIDENTAL=$(cat <<'EOF'
base: upstream/main
layers:
  # Post-#1195/#896 detect rebase — history note only
  - branch: feat/cursor-model-error-bridge
EOF
)
if mw_manifest_pr_layer_active "$MANIFEST_INCIDENTAL" 896; then bad "incidental /#896 must not count"; else ok; fi
if mw_manifest_pr_layer_active "$MANIFEST_INCIDENTAL" 1195; then bad "incidental Post-#1195 must not count"; else ok; fi


# --- worktree presence ---
WT="$(mktemp -d)"
mkdir -p "$WT/worktrees/foo"
touch "$WT/worktrees/foo/.git"
if mw_worktree_present "$WT/worktrees/foo"; then ok; else bad "existing worktree"; fi
mkdir -p "$WT/worktrees/husk/.cursor/rules"
if mw_worktree_present "$WT/worktrees/husk"; then bad "IDE husk (.cursor only) must be absent"; else ok; fi
if mw_worktree_present "$WT/worktrees/missing"; then bad "missing worktree"; else ok; fi
if mw_worktree_present "$HOME/coding/hapi"; then bad "mirror is not a worktree"; else ok; fi
if mw_worktree_present ""; then bad "empty path"; else ok; fi
rm -rf "$WT"

# --- member clean ---
got="$(mw_wave_member_clean "$MANIFEST_CLEAN" "/nope/worktrees/x" 896)" && ok || bad "clean exit 0"
eq "member clean both gone" "$got" "clean"
# Isolate declared Worktree: lookups from the real estate (agent-import-picker may exist).
EMPTY_WT_ROOT="$(mktemp -d)"
export HAPI_META_WORKTREES_ROOT="$EMPTY_WT_ROOT"
reason="$(mw_wave_member_clean "$MANIFEST_ACTIVE" "" 896 || true)"
eq "member dirty layer only" "$reason" "layer"
unset HAPI_META_WORKTREES_ROOT
rmdir "$EMPTY_WT_ROOT"
WT="$(mktemp -d)"; mkdir -p "$WT/worktrees/foo"; touch "$WT/worktrees/foo/.git"
reason="$(mw_wave_member_clean "$MANIFEST_CLEAN" "$WT/worktrees/foo" 896 || true)"
eq "member dirty worktree only" "$reason" "worktree"
# husk after worktree remove must not dirty gate A
mkdir -p "$WT/worktrees/husk/.cursor"
got="$(mw_wave_member_clean "$MANIFEST_CLEAN" "$WT/worktrees/husk" 896)" && ok || bad "husk should be clean"
eq "member clean IDE husk" "$got" "clean"
rm -rf "$WT"

# Stale session path pointing at an unrelated live worktree must NOT keep Gate A
# dirty after the PR layer is DROPPED (2026-08-11 #1413 ping loop).
WT="$(mktemp -d)"
mkdir -p "$WT/worktrees/hub-runner-version-skew" "$WT/worktrees/share-native-deeplink"
touch "$WT/worktrees/hub-runner-version-skew/.git"
# Feature wt already gone; only unrelated wt remains
rm -rf "$WT/worktrees/share-native-deeplink"
MANIFEST_DROP_1413=$(cat <<'EOF'
base: upstream/main
layers:
  # DROPPED 2026-08-11: feat/share-native-fileurl (was driver/share-native-deeplink)
  # MERGED as tiann/hapi#1413 (a0621194 — Fixes #1412)
  # Worktree: ~/coding/hapi/worktrees/share-native-deeplink
EOF
)
got="$(mw_wave_member_clean "$MANIFEST_DROP_1413" "$WT/worktrees/hub-runner-version-skew" 1413)" && ok || bad "stale unrelated path must be Gate A clean"
eq "stale unrelated session path clean" "$got" "clean"

# Declared Worktree: for this PR still on disk → dirty even if session path is mirror
mkdir -p "$WT/worktrees/share-native-deeplink"
touch "$WT/worktrees/share-native-deeplink/.git"
# Override resolver root for declared relative worktrees
export HAPI_META_WORKTREES_ROOT="$WT/worktrees"
reason="$(mw_wave_member_clean "$MANIFEST_DROP_1413" "$HOME/coding/hapi" 1413 || true)"
eq "declared Worktree still present dirty" "$reason" "worktree"
# Attributable session path still present → dirty
reason="$(mw_wave_member_clean "$MANIFEST_DROP_1413" "$WT/worktrees/share-native-deeplink" 1413 || true)"
eq "attributable session path dirty" "$reason" "worktree"
unset HAPI_META_WORKTREES_ROOT
rm -rf "$WT"

# Active layer + unrelated session path still dirties (legacy fail-closed)
WT="$(mktemp -d)"
mkdir -p "$WT/worktrees/other-feature"
touch "$WT/worktrees/other-feature/.git"
reason="$(mw_wave_member_clean "$MANIFEST_ACTIVE" "$WT/worktrees/other-feature" 896 || true)"
eq "active layer + any live session wt dirty" "$reason" "layer+worktree"
rm -rf "$WT"

# MERGED as owner/repo#N counts as DROPPED
MANIFEST_OWNER_REPO=$(cat <<'EOF'
base: upstream/main
layers:
  # DROPPED 2026-08-11: tip
  # MERGED as tiann/hapi#1413
  - branch: should-not-count-because-dropped-block-wrong
EOF
)
# The active - branch: after a DROPPED block that mentions 1413 should be clean
# for 1413 (dropped matcher), not attributed as active.
if mw_manifest_pr_layer_active "$MANIFEST_OWNER_REPO" 1413; then bad "tiann/hapi#1413 DROPPED must be clean"; else ok; fi

# --- wave id ---
eq "wave id sorted" "$(mw_wave_id_from_prs 945 896)" "w-896-945"

# --- advance: all dirty → idle ---
out="$(mw_advance_wave '{"status":"idle"}' '[{"pr":896,"sid":"aaaa","clean":false}]' 1000 1800 0)"
eq "all dirty status idle" "$(jq -r '.wave.status' <<<"$out")" "idle"
eq "all dirty no unlock" "$(jq -r '.unlock' <<<"$out")" "false"

# --- advance: first clean → collecting ---
out="$(mw_advance_wave '{"status":"idle"}' '[{"pr":896,"sid":"aaaa","clean":true},{"pr":945,"sid":"bbbb","clean":false}]' 1000 1800 0)"
eq "mixed status collecting" "$(jq -r '.wave.status' <<<"$out")" "collecting"
eq "mixed emit_collect" "$(jq -r '.emit_collect' <<<"$out")" "true"
eq "mixed no unlock" "$(jq -r '.unlock' <<<"$out")" "false"
eq "collect deadline" "$(jq -r '.wave.collect_deadline_at' <<<"$out")" "2800"

# --- advance: all clean early → unlock/dispatch ---
out="$(mw_advance_wave '{"status":"idle"}' '[{"pr":896,"sid":"aaaa","clean":true}]' 1000 1800 0)"
eq "all clean unlock" "$(jq -r '.unlock' <<<"$out")" "true"
eq "all clean dispatched" "$(jq -r '.wave.status' <<<"$out")" "dispatched"
eq "all clean emit_ready" "$(jq -r '.emit_ready' <<<"$out")" "true"

# --- advance: ready + rebuild busy → stay ready, no unlock ---
prev="$(jq -c '.wave' <<<"$out" | jq -c '.status="ready"')"
out="$(mw_advance_wave "$prev" '[{"pr":896,"sid":"aaaa","clean":true}]' 2000 1800 1 1)"
eq "busy no unlock" "$(jq -r '.unlock' <<<"$out")" "false"
eq "busy stay ready" "$(jq -r '.wave.status' <<<"$out")" "ready"
eq "busy defer" "$(jq -r '.defer_reason' <<<"$out")" "rebuild_busy"
eq "busy no re-emit ready" "$(jq -r '.emit_ready' <<<"$out")" "false"

# --- advance: ready + allow_dispatch=0 (--no-ping) → stay ready ---
out="$(mw_advance_wave "$prev" '[{"pr":896,"sid":"aaaa","clean":true}]' 2000 1800 0 0)"
eq "no-ping no unlock" "$(jq -r '.unlock' <<<"$out")" "false"
eq "no-ping stay ready" "$(jq -r '.wave.status' <<<"$out")" "ready"
eq "no-ping defer window" "$(jq -r '.defer_reason' <<<"$out")" "awaiting_ping_window"

# --- advance: already dispatched → no re-unlock ---
prev="$(jq -c '.wave' <<<"$(mw_advance_wave '{"status":"idle"}' '[{"pr":896,"sid":"aaaa","clean":true}]' 1000 1800 0)")"
out="$(mw_advance_wave "$prev" '[{"pr":896,"sid":"aaaa","clean":true}]' 3000 1800 0)"
eq "dispatched sticky" "$(jq -r '.wave.status' <<<"$out")" "dispatched"
eq "dispatched no unlock" "$(jq -r '.unlock' <<<"$out")" "false"
eq "dispatched defer" "$(jq -r '.defer_reason' <<<"$out")" "already_dispatched"

# --- dispatched survives dirty flicker (2026-08-10 hourly re-unlock) ---
flicker="$(mw_advance_wave "$prev" '[{"pr":896,"sid":"aaaa","clean":false}]' 4000 1800 0)"
eq "dispatched sticky while dirty" "$(jq -r '.wave.status' <<<"$flicker")" "dispatched"
eq "dispatched dirty no unlock" "$(jq -r '.unlock' <<<"$flicker")" "false"
out="$(mw_advance_wave "$(jq -c '.wave' <<<"$flicker")" '[{"pr":896,"sid":"aaaa","clean":true}]' 5000 1800 0)"
eq "dispatched after re-clean" "$(jq -r '.wave.status' <<<"$out")" "dispatched"
eq "dispatched after re-clean no unlock" "$(jq -r '.unlock' <<<"$out")" "false"

# --- orphans never in members (caller contract) — empty members → idle ---
out="$(mw_advance_wave '{"status":"ready"}' '[]' 1000 1800 0)"
eq "empty members idle" "$(jq -r '.wave.status' <<<"$out")" "idle"

# --- event body ---
body="$(mw_build_wave_event_body --repo tiann/hapi --wave-id w-896 --prs-csv 896 --kind ready --session-id meta-tooling --date 2026-07-29)"
eq "event tags soup-rebuild" "$(jq -r '.tags[0]' <<<"$body")" "soup-rebuild"
eq "event type needs_decision" "$(jq -r '.eventType' <<<"$body")" "needs_decision"
eq "event summary wave clear" "$(jq -r '.summary' <<<"$body" | grep -c 'WAVE CLEAR')" "1"

# --- complete (🧹) predicates ---
GIT_TMP="$(mktemp -d)"
git -C "$GIT_TMP" init -q
git -C "$GIT_TMP" commit --allow-empty -q -m init
# default branch tip exists but feat/gone does not
if mw_branch_absent "$GIT_TMP" "feat/gone"; then ok; else bad "absent branch should be clean"; fi
git -C "$GIT_TMP" checkout -q -b feat/alive
if mw_branch_absent "$GIT_TMP" "feat/alive"; then bad "alive branch present"; else ok; fi

MANIFEST_DROP="$(cat <<'EOF'
  # DROPPED 2026-08-04: feat/x MERGED as #1366
  # - branch: feat/x
EOF
)"
reason="$(mw_member_complete "$MANIFEST_DROP" "/tmp/no-wt" 1366 archived "$GIT_TMP" "feat/gone" || true)"
eq "complete all preds" "$reason" "complete"
# mw_member_complete exits 0 on complete — re-run for exit check
if mw_member_complete "$MANIFEST_DROP" "/tmp/no-wt" 1366 archived "$GIT_TMP" "feat/gone"; then ok; else bad "should be complete"; fi

reason="$(mw_member_complete "$MANIFEST_DROP" "/tmp/no-wt" 1366 running "$GIT_TMP" "feat/gone" || true)"
eq "complete needs archived" "$reason" "not_archived"

reason="$(mw_member_complete "$MANIFEST_DROP" "/tmp/no-wt" 1366 archived "$GIT_TMP" "" || true)"
eq "complete needs headRef" "$reason" "no_branch"

rm -rf "$GIT_TMP"

echo ""
echo "meta-wave.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
