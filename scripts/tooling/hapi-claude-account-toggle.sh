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

# Validate slot credentials JSON BEFORE any backup or auth-surface mutation
# (malformed JSON must not leave active/credentials/canon half-switched).
TIER="$(python3 - "$CRED" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except OSError as exc:
    sys.stderr.write("ERROR: cannot read slot credentials %s: %s\n" % (path, exc))
    sys.exit(1)
except json.JSONDecodeError as exc:
    sys.stderr.write("ERROR: invalid JSON in slot credentials %s: %s\n" % (path, exc))
    sys.exit(1)
if not isinstance(data, dict):
    sys.stderr.write("ERROR: slot credentials must be a JSON object: %s\n" % path)
    sys.exit(1)
oauth = data.get("claudeAiOauth")
if oauth is not None and not isinstance(oauth, dict):
    sys.stderr.write("ERROR: claudeAiOauth must be an object in %s\n" % path)
    sys.exit(1)
print((oauth or {}).get("rateLimitTier", "?"))
PY
)" || exit 1

# systemd last-assignment-wins - require the *final* value to be nonempty.
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
prev_cred="$ROOT/auth-bak/.credentials.json.bak-toggle-$TS"
cred_existed_before=0
if [[ -f "$HOME/.claude/.credentials.json" && ! -L "$HOME/.claude/.credentials.json" ]]; then
    cred_existed_before=1
    cp -f "$HOME/.claude/.credentials.json" "$prev_cred"
fi

# Backup prior canonical token into operator-owned auth-bak WITHOUT privileged
# cp into a user-controlled path (symlink TOCTOU). Root only reads CANON via
# O_NOFOLLOW; the operator process creates the backup with O_EXCL|O_NOFOLLOW.
bak="$ROOT/auth-bak/claude-setup-token.env.bak-toggle-$TS"
canon_existed_before=0
if [[ -e "$CANON" || -L "$CANON" ]]; then
    canon_existed_before=1
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

# Install canonical token FIRST (both OAuth surfaces must switch together).
# Privileged path: pipe bytes from an already-opened O_NOFOLLOW read into a
# root writer that never reopens a user-writable pathname (mktemp race).
canon_parent="$(dirname "$CANON")"
if [[ ! -d "$canon_parent" ]]; then
    sudo install -d -m 0755 "$canon_parent"
fi
hapi_claude_oauth_assert_root_controlled_parent "$canon_parent" || exit 1
if [[ -L "$CANON" ]]; then
    echo "ERROR: refusing to install over symlink $CANON" >&2
    exit 1
fi
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    hapi_claude_oauth_secure_copy_regular_file "$TOKEN" "$CANON"
else
    # Unprivileged O_NOFOLLOW cat → privileged install via absolute python3.
    # Never PATH-resolve bash under sudo or source this checkout as root.
    # install_bytes refuses empty/ineffective payload before os.replace.
    hapi_claude_oauth_cat_regular_file "$TOKEN" \
        | hapi_claude_oauth_install_bytes_via_sudo "$CANON"
fi

# Restore CANON from pre-toggle backup if interactive credentials cannot be
# committed (avoids runner/interactive account split after canonical-first write).
# If CANON was newly created this run (no prior file / no backup), unlink it.
# Restore uses restore_bytes (not install_bytes) so empty prior tokens can return.
hapi_claude_oauth_rollback_canon_from_bak() {
    local why="${1:-credentials update failed}"
    echo "ERROR: $why - rolling back canonical token at $CANON" >&2
    if [[ -f "$bak" && ! -L "$bak" ]]; then
        if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
            hapi_claude_oauth_secure_copy_regular_file "$bak" "$CANON" || {
                echo "ERROR: failed to restore $CANON from $bak" >&2
                return 1
            }
        else
            hapi_claude_oauth_cat_regular_file "$bak" \
                | hapi_claude_oauth_restore_bytes_via_sudo "$CANON" || {
                echo "ERROR: failed to restore $CANON from $bak (sudo)" >&2
                return 1
            }
        fi
        echo "Restored canonical token from $bak"
        return 0
    fi
    if [[ "$canon_existed_before" -eq 0 ]]; then
        if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
            hapi_claude_oauth_secure_unlink_regular_file "$CANON" || {
                echo "ERROR: failed to remove newly created $CANON" >&2
                return 1
            }
        else
            hapi_claude_oauth_secure_unlink_regular_file_via_sudo "$CANON" || {
                echo "ERROR: failed to remove newly created $CANON (sudo)" >&2
                return 1
            }
        fi
        echo "Removed newly created canonical token $CANON (no prior backup)"
        return 0
    fi
    echo "WARN: no prior canonical backup at $bak and CANON existed before toggle - cannot safely roll back $CANON" >&2
    return 1
}

# Restore interactive credentials after a failed copy/chmod/active write.
hapi_claude_oauth_rollback_credentials() {
    if [[ -f "$prev_cred" && ! -L "$prev_cred" ]]; then
        if ! cp -a "$prev_cred" "$HOME/.claude/.credentials.json"; then
            echo "ERROR: failed to restore interactive credentials from $prev_cred" >&2
            return 1
        fi
        chmod 600 "$HOME/.claude/.credentials.json" 2>/dev/null || true
        echo "Restored interactive credentials from $prev_cred"
        return 0
    fi
    if [[ "$cred_existed_before" -eq 0 ]]; then
        rm -f "$HOME/.claude/.credentials.json"
        echo "Removed partial interactive credentials (none existed before toggle)"
        return 0
    fi
    echo "WARN: no prior credentials backup at $prev_cred - cannot restore interactive credentials" >&2
    return 1
}

# Only after canonical token is installed: switch interactive credentials.
if ! cp -a "$CRED" "$HOME/.claude/.credentials.json"; then
    hapi_claude_oauth_rollback_canon_from_bak "cannot replace $HOME/.claude/.credentials.json"
    hapi_claude_oauth_rollback_credentials || true
    exit 1
fi
if ! chmod 600 "$HOME/.claude/.credentials.json"; then
    hapi_claude_oauth_rollback_canon_from_bak "cannot chmod 600 $HOME/.claude/.credentials.json"
    hapi_claude_oauth_rollback_credentials || true
    exit 1
fi
if ! echo "$SLOT" > "$ROOT/active"; then
    hapi_claude_oauth_rollback_canon_from_bak "cannot write $ROOT/active"
    hapi_claude_oauth_rollback_credentials || true
    exit 1
fi

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
