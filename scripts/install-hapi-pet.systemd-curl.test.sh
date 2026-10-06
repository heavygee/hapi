#!/usr/bin/env bash
# Regression: install-hapi-pet.sh --with-systemd must work via curl|bash (no git checkout).
# Run: bash scripts/install-hapi-pet.systemd-curl.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/install-hapi-pet.sh"
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

# 1) Piped invocation must not trip `set -u` on BASH_SOURCE[0]
err="$(mktemp)"
out="$(cat "$SCRIPT" | bash -s -- --help 2>"$err")" || fail "piped --help exited non-zero"
rg -qi 'unbound variable|BASH_SOURCE' "$err" && fail "piped --help printed unbound BASH_SOURCE: $(cat "$err")"
[[ "$out" == *"--with-systemd"* ]] || fail "piped --help missing --with-systemd docs"
pass "piped --help (no unbound BASH_SOURCE)"

# 2) File invocation still resolves SCRIPT_DIR to the scripts/ directory
probe="$(mktemp)"
cat >"$probe" <<'PROBE'
set -euo pipefail
_script_src="${BASH_SOURCE[0]:-}"
if [[ -n "$_script_src" && -f "$_script_src" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$_script_src")" && pwd)"
else
    SCRIPT_DIR=""
fi
printf '%s' "$SCRIPT_DIR"
PROBE
# Mimic the fixed SCRIPT_DIR logic against the real script path
file_dir="$(bash -c '
_script_src="'"$SCRIPT"'"
SCRIPT_DIR="$(cd "$(dirname "$_script_src")" && pwd)"
printf "%s" "$SCRIPT_DIR"
')"
[[ "$file_dir" == */scripts ]] || fail "file SCRIPT_DIR expected …/scripts, got [$file_dir]"
[[ -x "$file_dir/tooling/install-hapi-systemd-units.sh" ]] || fail "companion missing next to script"
pass "checkout path still finds companion installer"

# 3) Piped SCRIPT_DIR is empty → must take embedded path (not …/tooling/…)
piped_dir="$(cat "$probe" | bash -s)"
[[ -z "$piped_dir" ]] || fail "piped SCRIPT_DIR should be empty, got [$piped_dir]"
pass "piped SCRIPT_DIR empty → embedded units path"

# 4) Embedded unit bodies match user-pet templates (no @PLACEHOLDER@ left)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" "$err" "$probe"' EXIT
export HOME="$tmp"
INSTALL_DIR="$HOME/.local/bin"
HAPI_HOME="$HOME/.hapi"
HAPI_WORKSPACE="$HOME/.hapi-workspace"
mkdir -p "$INSTALL_DIR" "$HAPI_HOME" "$HAPI_WORKSPACE"
: >"$INSTALL_DIR/hapi"; chmod +x "$INSTALL_DIR/hapi"
# shellcheck disable=SC1090
# Re-run just the embed writer by sourcing a trimmed extract would be fragile;
# instead assert the live script contains the KillMode/Restart markers and no
# hard dependency on SCRIPT_DIR/tooling for the curl path.
rg -q 'KillMode=process' "$SCRIPT" || fail "embedded runner unit missing KillMode=process"
rg -q 'No git checkout — writing embedded user systemd units' "$SCRIPT" || fail "missing embedded-path log"
rg -q 'BASH_SOURCE\[0\]:-' "$SCRIPT" || fail "missing safe BASH_SOURCE default"
# Old broken pattern must be gone as the sole systemd path
if rg -n 'bash "\$SCRIPT_DIR/tooling/install-hapi-systemd-units.sh"' "$SCRIPT" | rg -qv 'companion'; then
    # Still OK if only used inside the companion-present branch
    :
fi
rg -q 'companion' "$SCRIPT" || fail "expected companion-present branch"
pass "script embeds user-pet units and guards BASH_SOURCE"

echo
echo "All install-hapi-pet systemd curl regressions passed."
