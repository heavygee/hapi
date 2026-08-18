#!/usr/bin/env bash
# Smoke tests for hapi-manifest-drop-gate.sh (branch list + removal diff).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-manifest-drop-gate.sh
source "$SCRIPT_DIR/lib/hapi-manifest-drop-gate.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ok() { echo "ok: $1"; }
bad() { echo "FAIL: $1" >&2; exit 1; }

cat >"$WORK/old.yaml" <<'EOF'
layers:
  - branch: feat/keep-me
  - branch: feat/drop-candidate
EOF

cat >"$WORK/new.yaml" <<'EOF'
layers:
  - branch: feat/keep-me
EOF

removed="$(hapi_manifest_removed_branches "$WORK/old.yaml" "$WORK/new.yaml" | tr '\n' ' ')"
[[ "$removed" == *"feat/drop-candidate"* ]] || bad "expected feat/drop-candidate in removed list: $removed"
ok "removed branch detection"

list="$(hapi_manifest_list_active_branches "$WORK/old.yaml" | tr '\n' ' ')"
[[ "$list" == *"feat/keep-me"* && "$list" == *"feat/drop-candidate"* ]] || bad "list branches: $list"
ok "active branch list"

# Gate passes when gh unavailable is not tested here; skip open-PR integration without network.
echo "hapi-manifest-drop-gate.test.sh: all local checks passed"
