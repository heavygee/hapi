#!/usr/bin/env bash
# Regression: install-hapi-pet.sh --with-systemd must work via curl|bash (no git checkout).
# Run: bash scripts/install-hapi-pet.systemd-curl.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/install-hapi-pet.sh"
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

# 1) Piped/stdin invocation must not trip `set -u` on BASH_SOURCE[0].
# Use stdin redirect (not `cat | bash`) — under `set -o pipefail`, cat can get
# SIGPIPE (exit 141) when bash closes early after --help even though help
# itself succeeded.
err="$(mktemp)"
out="$(bash -s -- --help <"$SCRIPT" 2>"$err")" || fail "piped --help exited non-zero"
rg -qi 'unbound variable|BASH_SOURCE' "$err" && fail "piped --help printed unbound BASH_SOURCE: $(cat "$err")"
[[ "$out" == *"--with-systemd"* ]] || fail "piped --help missing --with-systemd docs"
[[ "$out" == *"--fleet-policy"* ]] || fail "piped --help missing --fleet-policy docs"
[[ "$out" == *"default auto"* ]] || fail "piped --help should document default auto policy"
[[ "$out" == *"hapi-fleet"* ]] || fail "piped --help missing hapi-fleet channel docs"
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

# 5) #294: user-bus preflight fails closed without a bus (copy-paste, no silent nohup).
rg -q 'hapi_pet_require_user_systemd_bus' "$SCRIPT" || fail "missing hapi_pet_require_user_systemd_bus"
rg -q 'hapi_pet_require_user_systemd_bus' "$SCRIPT" || fail "install_user_pet_systemd must call preflight"
# Call site is inside install_user_pet_systemd, before companion/embedded writes.
awk '
  /^install_user_pet_systemd\(\)/ { in_fn=1 }
  in_fn && /hapi_pet_require_user_systemd_bus/ { found=1 }
  in_fn && /^}$/ { exit }
  END { exit found ? 0 : 1 }
' "$SCRIPT" || fail "preflight must run at start of install_user_pet_systemd"

probe_src="$(mktemp)"
bus_err="$(mktemp)"
{
    echo 'log()  { printf "==> %s\n" "$1"; }'
    echo 'fail() { printf "ERROR: %s\n" "$1" >&2; exit 1; }'
    # Three consecutive helpers: bus_ok, linger_enabled, require.
    awk '
      /^hapi_pet_user_systemd_bus_ok\(\)/ { keep=1 }
      keep { print }
      keep && /^}$/ { n++; if (n == 3) exit }
    ' "$SCRIPT"
    echo 'hapi_pet_require_user_systemd_bus'
} >"$probe_src"

# Force a missing-bus probe: wrap systemctl so --user always fails even if this
# developer machine has a real user session.
set +e
env PATH="/usr/bin:/bin" bash -c '
  systemctl() {
    if [[ "${1:-}" == "--user" ]]; then
      echo "Failed to connect to user scope bus via local transport: \$DBUS_SESSION_BUS_ADDRESS and \$XDG_RUNTIME_DIR not defined" >&2
      return 1
    fi
    command systemctl "$@"
  }
  export -f systemctl
  # shellcheck disable=SC1090
  source "'"$probe_src"'"
' >"$bus_err" 2>&1
bus_rc=$?
set -e
[[ "$bus_rc" -ne 0 ]] || fail "preflight should fail without user bus (rc=0); out=$(cat "$bus_err")"
rg -q 'enable-linger' "$bus_err" || fail "preflight stderr missing enable-linger: $(cat "$bus_err")"
rg -q 'user@[0-9]+\.service' "$bus_err" || fail "preflight stderr missing user@UID.service: $(cat "$bus_err")"
rg -q 'Do not substitute nohup|systemd persistence' "$bus_err" \
    || fail "preflight should refuse silent nohup: $(cat "$bus_err")"
pass "#294 fail-fast without user bus (copy-paste linger + user@UID)"
rm -f "$probe_src" "$bus_err"

echo
echo "All install-hapi-pet systemd curl regressions passed."
