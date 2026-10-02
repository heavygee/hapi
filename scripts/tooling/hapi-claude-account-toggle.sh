#!/usr/bin/env bash
# hapi-claude-account-toggle.sh — switch oos-linux Claude auth slot (primary | secondary).
#
# Copies both OAuth surfaces for the slot:
#   ~/.claude/.credentials.json                 (interactive claude)
#   /etc/hapi/claude-setup-token.env            (systemd → hapi-runner-oos CLAUDE_CODE_OAUTH_TOKEN)
#
# Slot storage (still under operator home):
#   ~/.hapi/claude-auth/{primary,secondary}/.credentials.json
#   ~/.hapi/claude-auth/{primary,secondary}/claude-setup-token.env
#   ~/.hapi/claude-auth/active
#
# Usage:
#   hapi-claude-account-toggle.sh primary|secondary [--skip-restart] [--skip-smoke]
#
# Runner restart is a production mutation — run from a real TTY with operator approval.
set -euo pipefail

SLOT="${1:-}"
[[ -n "$SLOT" ]] || { echo "Usage: $0 primary|secondary [--skip-restart] [--skip-smoke]" >&2; exit 1; }
[[ "$SLOT" == primary || "$SLOT" == secondary ]] || { echo "slot must be primary or secondary" >&2; exit 1; }

SKIP_RESTART=0
SKIP_SMOKE=0
for arg in "${@:2}"; do
    case "$arg" in
        --skip-restart) SKIP_RESTART=1 ;;
        --skip-smoke) SKIP_SMOKE=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-oauth-dropin.sh
source "$SCRIPT_DIR/lib/hapi-claude-oauth-dropin.sh"

ROOT="$HOME/.hapi/claude-auth"
CRED="$ROOT/$SLOT/.credentials.json"
TOKEN="$ROOT/$SLOT/claude-setup-token.env"
# Canonical EnvironmentFile for hapi-runner-oos (root-controlled; not ~/.hapi/).
CANON="$(hapi_claude_oauth_system_token_file)"

[[ -f "$CRED" ]] || { echo "missing $CRED" >&2; exit 1; }
[[ -f "$TOKEN" ]] || { echo "missing $TOKEN" >&2; exit 1; }
hapi_claude_oauth_assert_safe_token_file "$TOKEN" || exit 1

# systemd last-assignment-wins — require the *final* value to be nonempty.
set +e
EFFECTIVE="$(hapi_claude_oauth_effective_token_value "$TOKEN")"
eff_rc=$?
set -e
if [[ "$eff_rc" -ne 0 || -z "$EFFECTIVE" ]]; then
    echo "no nonempty final CLAUDE_CODE_OAUTH_TOKEN= assignment in $TOKEN" >&2
    exit 1
fi

TS="$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$HOME/.claude" "$HOME/.hapi" "$ROOT/auth-bak"
for f in "$HOME/.claude/.credentials.json"; do
    [[ -f "$f" ]] && cp -f "$f" "$ROOT/auth-bak/$(basename "$f").bak-toggle-$TS"
done

# Backup prior canonical token into operator-owned auth-bak WITHOUT privileged
# cp into a user-controlled path (symlink TOCTOU). Root only reads CANON via
# O_NOFOLLOW; the operator process creates the backup with O_EXCL|O_NOFOLLOW.
bak="$ROOT/auth-bak/claude-setup-token.env.bak-toggle-$TS"
if [[ -e "$CANON" || -L "$CANON" ]]; then
    if [[ -r "$CANON" && ! -L "$CANON" ]]; then
        hapi_claude_oauth_secure_copy_regular_file "$CANON" "$bak"
    else
        # Privileged read → unprivileged exclusive write (never sudo cp to auth-bak).
        sudo python3 - "$CANON" <<'PY' | hapi_claude_oauth_secure_write_new_file "$bak"
import os, stat, sys
path = sys.argv[1]
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
if hasattr(os, "O_NONBLOCK"):
    flags |= os.O_NONBLOCK
fd = os.open(path, flags)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular canonical token: %s\n" % path)
        sys.exit(1)
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
finally:
    os.close(fd)
PY
    fi
fi
# Also snapshot the old operator path once (pre-migrate leftover).
if [[ -f "$HOME/.hapi/claude-setup-token.env" && ! -L "$HOME/.hapi/claude-setup-token.env" ]]; then
    hapi_claude_oauth_secure_copy_regular_file \
        "$HOME/.hapi/claude-setup-token.env" \
        "$ROOT/auth-bak/claude-setup-token.env.legacy-home.bak-toggle-$TS"
fi

cp -a "$CRED" "$HOME/.claude/.credentials.json"
chmod 600 "$HOME/.claude/.credentials.json"

# Install slot token to root-controlled canonical path (never cp -a into /etc).
canon_parent="$(dirname "$CANON")"
if [[ ! -d "$canon_parent" ]]; then
    sudo install -d -m 0755 "$canon_parent"
fi
hapi_claude_oauth_assert_root_controlled_parent "$canon_parent" || exit 1
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    hapi_claude_oauth_secure_copy_regular_file "$TOKEN" "$CANON"
else
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    hapi_claude_oauth_secure_copy_regular_file "$TOKEN" "$tmp"
    # install -T replaces a non-directory dest without following a symlink name
    # when --backup is unset; still refuse if CANON is currently a symlink.
    if [[ -L "$CANON" ]]; then
        echo "ERROR: refusing to install over symlink $CANON" >&2
        exit 1
    fi
    sudo install -m 0600 -o root -g root "$tmp" "$CANON"
    rm -f "$tmp"
    trap - EXIT
fi
echo "$SLOT" > "$ROOT/active"

TIER="$(python3 - <<PY
import json
print(json.load(open("$CRED")).get("claudeAiOauth", {}).get("rateLimitTier", "?"))
PY
)"
SHA12="$(printf '%s' "$EFFECTIVE" | sha256sum | cut -c1-12)"
echo "== claude auth → slot '$SLOT' tier=$TIER token_sha12=$SHA12 canon=$CANON =="

if [[ "$SKIP_RESTART" -eq 0 ]]; then
    HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 HAPI_OPERATOR_PRODUCTION_MUTATION_OVERRIDE=1 \
        sudo -E systemctl restart hapi-runner-oos.service
    sleep 2
    systemctl is-active hapi-runner-oos.service
fi

if [[ "$SKIP_SMOKE" -eq 0 ]]; then
    echo "-- smoke (oos, credentials.json only; runner uses /etc/hapi setup-token) --"
    (
        unset CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_OAUTH_REFRESH_TOKEN 2>/dev/null || true
        timeout 75 claude -p --output-format text "reply exactly: claude-slot-$SLOT-ok"
    ) || echo "WARNING: smoke failed — check quota or claude login"
fi

echo "== done: oos-linux on claude slot '$SLOT' =="
