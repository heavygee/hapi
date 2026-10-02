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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
grep -q $'^CLAUDE_CODE_OAUTH_TOKEN=[^[:space:]]' "$TOKEN" || {
    echo "no nonempty CLAUDE_CODE_OAUTH_TOKEN in $TOKEN" >&2
    exit 1
}

TS="$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$HOME/.claude" "$HOME/.hapi" "$ROOT/auth-bak"
for f in "$HOME/.claude/.credentials.json"; do
    [[ -f "$f" ]] && cp -f "$f" "$ROOT/auth-bak/$(basename "$f").bak-toggle-$TS"
done
# Backup prior canonical token if present (may need sudo to read).
if [[ -r "$CANON" ]]; then
    cp -f "$CANON" "$ROOT/auth-bak/claude-setup-token.env.bak-toggle-$TS" 2>/dev/null \
        || sudo cp -f "$CANON" "$ROOT/auth-bak/claude-setup-token.env.bak-toggle-$TS"
elif [[ -e "$CANON" ]]; then
    sudo cp -f "$CANON" "$ROOT/auth-bak/claude-setup-token.env.bak-toggle-$TS"
fi
# Also snapshot the old operator path once (pre-migrate leftover).
if [[ -f "$HOME/.hapi/claude-setup-token.env" && ! -L "$HOME/.hapi/claude-setup-token.env" ]]; then
    cp -f "$HOME/.hapi/claude-setup-token.env" \
        "$ROOT/auth-bak/claude-setup-token.env.legacy-home.bak-toggle-$TS"
fi

cp -a "$CRED" "$HOME/.claude/.credentials.json"
chmod 600 "$HOME/.claude/.credentials.json"

# Install slot token to root-controlled canonical path (never cp -a into /etc).
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    hapi_claude_oauth_secure_copy_regular_file "$TOKEN" "$CANON"
else
    # Copy to a temp regular file we own, then install with sudo (no symlink preserve).
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    hapi_claude_oauth_secure_copy_regular_file "$TOKEN" "$tmp"
    sudo install -d -m 0755 "$(dirname "$CANON")"
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
SHA12="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' "$TOKEN" | head -1 | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)"
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
