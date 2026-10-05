#!/usr/bin/env bash
# Auto-detect systemd user session for install-hapi-pet.sh (nohup fallback).
# Run: bash scripts/install-hapi-pet.systemd-detect.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/install-hapi-pet.sh"
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

log() { :; }

extract_fn() {
    local name="$1"
    awk -v n="$name" '
        $0 ~ "^" n "\\(\\) \\{" {grab=1}
        grab {print}
        grab && $0 == "}" {exit}
    ' "$SCRIPT"
}

# --- help / flags ---
help_out="$(bash "$SCRIPT" --help)"
[[ "$help_out" == *"--with-systemd"* ]] || fail "--help missing --with-systemd"
[[ "$help_out" == *"--no-systemd"* ]] || fail "--help missing --no-systemd"
[[ "$help_out" == *"auto"* || "$help_out" == *"detect"* ]] || fail "--help should say systemd is auto-detected"
pass "help documents auto-detect and both overrides"

[[ "$(extract_fn hapi_pet_systemd_user_available)" == *hapi_pet_systemd_user_available* ]] \
    || fail "missing hapi_pet_systemd_user_available()"
[[ "$(extract_fn hapi_pet_resolve_with_systemd)" == *hapi_pet_resolve_with_systemd* ]] \
    || fail "missing hapi_pet_resolve_with_systemd()"

eval "$(extract_fn hapi_pet_systemd_user_available)"
eval "$(extract_fn hapi_pet_resolve_with_systemd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# No systemctl on PATH
(
    export HAPI_PET_TEST_NO_SYSTEMCTL=1
    export HAPI_PET_PID1_COMM=systemd
    export XDG_RUNTIME_DIR="$tmp/empty-runtime"
    mkdir -p "$XDG_RUNTIME_DIR"
    if hapi_pet_systemd_user_available; then
        fail "expected unavailable when systemctl is missing"
    fi
)
pass "detect fails without systemctl"

# systemctl exists, PID 1 is not systemd
mkdir -p "$tmp/bin"
cat >"$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$tmp/bin/systemctl"
(
    PATH="$tmp/bin:/usr/bin:/bin"
    export HAPI_PET_PID1_COMM=init
    export XDG_RUNTIME_DIR="$tmp/rt-init"
    mkdir -p "$XDG_RUNTIME_DIR/systemd"
    python3 - "$XDG_RUNTIME_DIR/systemd/private" <<'PY'
import socket, sys, os
p = sys.argv[1]
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    os.unlink(p)
except FileNotFoundError:
    pass
s = socket.socket(socket.AF_UNIX)
s.bind(p)
s.listen(1)
open(os.environ["XDG_RUNTIME_DIR"] + "/.keep", "w").write("1")
# keep socket inode; close after bind is enough for -S on Linux
PY
    if hapi_pet_systemd_user_available; then
        fail "expected unavailable when PID1 is not systemd"
    fi
)
pass "detect fails when PID 1 is not systemd"

# systemd PID1 + socket, but systemctl --user cannot talk
cat >"$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
echo "Failed to connect to bus" >&2
exit 1
EOF
chmod +x "$tmp/bin/systemctl"
(
    PATH="$tmp/bin:/usr/bin:/bin"
    export HAPI_PET_PID1_COMM=systemd
    export XDG_RUNTIME_DIR="$tmp/rt-dead"
    mkdir -p "$XDG_RUNTIME_DIR/systemd"
    python3 -c 'import socket,os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p),exist_ok=True)
try: os.unlink(p)
except FileNotFoundError: pass
s=socket.socket(socket.AF_UNIX); s.bind(p)' "$XDG_RUNTIME_DIR/systemd/private"
    if hapi_pet_systemd_user_available; then
        fail "expected unavailable when systemctl --user cannot talk to the session"
    fi
)
pass "detect fails when user manager is not reachable"

# Happy path: PID1 systemd, private socket, systemctl --user show-environment succeeds
cat >"$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
if [ "$1" = "--user" ] && [ "$2" = "show-environment" ]; then
    echo HOME=/tmp
    exit 0
fi
if [ "$1" = "--user" ] && [ "$2" = "is-system-running" ]; then
    echo running
    exit 0
fi
exit 1
EOF
chmod +x "$tmp/bin/systemctl"
(
    PATH="$tmp/bin:/usr/bin:/bin"
    export HAPI_PET_PID1_COMM=systemd
    export XDG_RUNTIME_DIR="$tmp/rt-ok"
    mkdir -p "$XDG_RUNTIME_DIR/systemd"
    python3 -c 'import socket,os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p),exist_ok=True)
try: os.unlink(p)
except FileNotFoundError: pass
s=socket.socket(socket.AF_UNIX); s.bind(p)' "$XDG_RUNTIME_DIR/systemd/private"
    hapi_pet_systemd_user_available || fail "expected available on happy-path stub"
)
pass "detect succeeds with PID1 systemd + user manager socket + systemctl --user"

happy_detect() {
    PATH="$tmp/bin:/usr/bin:/bin"
    export HAPI_PET_PID1_COMM=systemd
    unset HAPI_PET_TEST_NO_SYSTEMCTL
    export XDG_RUNTIME_DIR="$tmp/rt-ok"
    mkdir -p "$XDG_RUNTIME_DIR/systemd"
    python3 -c 'import socket,os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p),exist_ok=True)
try: os.unlink(p)
except FileNotFoundError: pass
s=socket.socket(socket.AF_UNIX); s.bind(p)' "$XDG_RUNTIME_DIR/systemd/private"
}

# resolve: auto + available → 1; auto + unavailable → 0; on requires detect
SYSTEMD_PREF=off
WITH_SYSTEMD=
hapi_pet_resolve_with_systemd
[[ "$WITH_SYSTEMD" -eq 0 ]] || fail "--no-systemd must force 0"
pass "resolve --no-systemd forces nohup"

SYSTEMD_PREF=on
export HAPI_PET_TEST_NO_SYSTEMCTL=1
if (
    fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
    hapi_pet_resolve_with_systemd
); then
    fail "--with-systemd must fail closed when the user session is unusable"
fi
unset HAPI_PET_TEST_NO_SYSTEMCTL
pass "resolve --with-systemd fails before launch when detect fails"

(
    happy_detect
    SYSTEMD_PREF=on
    WITH_SYSTEMD=
    hapi_pet_resolve_with_systemd
    [[ "$WITH_SYSTEMD" -eq 1 ]] || fail "--with-systemd must set 1 when detect succeeds"
)
pass "resolve --with-systemd forces units when session works"

(
    happy_detect
    SYSTEMD_PREF=auto
    WITH_SYSTEMD=
    hapi_pet_resolve_with_systemd
    [[ "$WITH_SYSTEMD" -eq 1 ]] || fail "auto should pick systemd when detect succeeds"
)
pass "resolve auto uses systemd when session works"

# auto uses detect
SYSTEMD_PREF=auto
export HAPI_PET_TEST_NO_SYSTEMCTL=1
export HAPI_PET_PID1_COMM=systemd
export XDG_RUNTIME_DIR="$tmp/nope"
mkdir -p "$XDG_RUNTIME_DIR"
hapi_pet_resolve_with_systemd
[[ "$WITH_SYSTEMD" -eq 0 ]] || fail "auto should fall back to nohup when detect fails"
unset HAPI_PET_TEST_NO_SYSTEMCTL
pass "resolve auto falls back to nohup"

# fail closed before §4 stop
awk '
  /^hapi_pet_resolve_with_systemd$/ { r=NR }
  /^# --- 4\. / { s=NR }
  END { if (!(r && s && r < s)) exit 1 }
' "$SCRIPT" || fail "hapi_pet_resolve_with_systemd must run before §4 stop"
pass "resolve runs before stop-for-upgrade"

echo
echo "All install-hapi-pet systemd detect tests passed."
