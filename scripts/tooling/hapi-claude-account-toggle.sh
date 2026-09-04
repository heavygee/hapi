#!/usr/bin/env bash
# hapi-claude-account-toggle.sh — switch oos-linux Claude auth slot (primary | secondary).
#
# Copies both OAuth surfaces for the slot:
#   ~/.claude/.credentials.json          (interactive claude)
#   ~/.hapi/claude-setup-token.env       (systemd → hapi-runner-oos CLAUDE_CODE_OAUTH_TOKEN)
#
# Slot storage:
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

ROOT="$HOME/.hapi/claude-auth"
CRED="$ROOT/$SLOT/.credentials.json"
TOKEN="$ROOT/$SLOT/claude-setup-token.env"

[[ -f "$CRED" ]] || { echo "missing $CRED" >&2; exit 1; }
[[ -f "$TOKEN" ]] || { echo "missing $TOKEN" >&2; exit 1; }
grep -q '^CLAUDE_CODE_OAUTH_TOKEN=' "$TOKEN" || { echo "no CLAUDE_CODE_OAUTH_TOKEN in $TOKEN" >&2; exit 1; }

TS="$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$HOME/.claude" "$HOME/.hapi" "$ROOT/auth-bak"
for f in "$HOME/.claude/.credentials.json" "$HOME/.hapi/claude-setup-token.env"; do
    [[ -f "$f" ]] && cp -f "$f" "$ROOT/auth-bak/$(basename "$f").bak-toggle-$TS"
done

cp -a "$CRED" "$HOME/.claude/.credentials.json"
chmod 600 "$HOME/.claude/.credentials.json"
cp -a "$TOKEN" "$HOME/.hapi/claude-setup-token.env"
chmod 600 "$HOME/.hapi/claude-setup-token.env"
echo "$SLOT" > "$ROOT/active"

TIER="$(python3 - <<PY
import json
print(json.load(open("$CRED")).get("claudeAiOauth", {}).get("rateLimitTier", "?"))
PY
)"
SHA12="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' "$TOKEN" | head -1 | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)"
echo "== claude auth → slot '$SLOT' tier=$TIER token_sha12=$SHA12 =="

if [[ "$SKIP_RESTART" -eq 0 ]]; then
    HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 HAPI_OPERATOR_PRODUCTION_MUTATION_OVERRIDE=1 \
        sudo -E systemctl restart hapi-runner-oos.service
    sleep 2
    systemctl is-active hapi-runner-oos.service
fi

if [[ "$SKIP_SMOKE" -eq 0 ]]; then
    echo "-- smoke (oos, credentials.json only; runner uses setup-token) --"
    (
        unset CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_OAUTH_REFRESH_TOKEN 2>/dev/null || true
        timeout 75 claude -p --output-format text "reply exactly: claude-slot-$SLOT-ok"
    ) || echo "WARNING: smoke failed — check quota or claude login"
fi

echo "== done: oos-linux on claude slot '$SLOT' =="
