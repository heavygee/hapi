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

# --- worktree presence ---
WT="$(mktemp -d)"
mkdir -p "$WT/worktrees/foo"
if mw_worktree_present "$WT/worktrees/foo"; then ok; else bad "existing worktree"; fi
if mw_worktree_present "$WT/worktrees/missing"; then bad "missing worktree"; else ok; fi
if mw_worktree_present "$HOME/coding/hapi"; then bad "mirror is not a worktree"; else ok; fi
if mw_worktree_present ""; then bad "empty path"; else ok; fi
rm -rf "$WT"

# --- member clean ---
got="$(mw_wave_member_clean "$MANIFEST_CLEAN" "/nope/worktrees/x" 896)" && ok || bad "clean exit 0"
eq "member clean both gone" "$got" "clean"
reason="$(mw_wave_member_clean "$MANIFEST_ACTIVE" "" 896 || true)"
eq "member dirty layer only" "$reason" "layer"
WT="$(mktemp -d)"; mkdir -p "$WT/worktrees/foo"
reason="$(mw_wave_member_clean "$MANIFEST_CLEAN" "$WT/worktrees/foo" 896 || true)"
eq "member dirty worktree only" "$reason" "worktree"
rm -rf "$WT"

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

# --- orphans never in members (caller contract) — empty members → idle ---
out="$(mw_advance_wave '{"status":"ready"}' '[]' 1000 1800 0)"
eq "empty members idle" "$(jq -r '.wave.status' <<<"$out")" "idle"

# --- event body ---
body="$(mw_build_wave_event_body --repo tiann/hapi --wave-id w-896 --prs-csv 896 --kind ready --session-id meta-tooling --date 2026-07-29)"
eq "event tags soup-rebuild" "$(jq -r '.tags[0]' <<<"$body")" "soup-rebuild"
eq "event type needs_decision" "$(jq -r '.eventType' <<<"$body")" "needs_decision"
eq "event summary wave clear" "$(jq -r '.summary' <<<"$body" | grep -c 'WAVE CLEAR')" "1"

echo ""
echo "meta-wave.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
