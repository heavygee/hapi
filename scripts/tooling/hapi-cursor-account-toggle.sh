#!/usr/bin/env bash
# hapi-cursor-account-toggle.sh — switch the fleet's Cursor Agent account (oos-linux + proxmox).
#
# Usage: hapi-cursor-account-toggle.sh <account> [--skip-proxmox]
#
# Runs the "Switching Cursor account (operator)" procedure from
# docs/tooling/cursor-auth-fleet-sync.md end-to-end: archive current creds,
# write the target account's key into every derived file, reconcile
# auth.json via pin-cursor-auth.sh, restart both runners, smoke test.
#
# Source of truth for each account's key: ~/.hapi/cursor-accounts/<account>.env
# (a CURSOR_API_KEY=crsr_... line; chmod 600; never committed, never printed).
# Add a new account by dropping a same-shaped file there — this script does
# not hardcode account names.
#
# Restarting hapi-runner*.service is a production mutation gated by this
# host's Claude Code safety hook (see docs/tooling/driver-soup.md). Running
# this script IS the deliberate operator action that authorizes the
# restart — it does not export the override for anything beyond its own
# restart calls, and it must be run from a real TTY (sudo -E needs one on
# oos; the proxmox leg uses ssh -tt for the same reason).
set -euo pipefail

ACCOUNT="${1:-}"
[[ -n "$ACCOUNT" ]] || { echo "Usage: $0 <account> [--skip-proxmox|--skip-oos]" >&2; exit 1; }
SKIP_PROXMOX=0
SKIP_OOS=0
case "${2:-}" in
  --skip-proxmox) SKIP_PROXMOX=1 ;;
  --skip-oos) SKIP_OOS=1 ;;
esac

KEY_FILE="$HOME/.hapi/cursor-accounts/$ACCOUNT.env"
[[ -f "$KEY_FILE" ]] || { echo "missing $KEY_FILE (expected a CURSOR_API_KEY=crsr_... line)" >&2; exit 1; }
grep -q '^CURSOR_API_KEY=crsr_' "$KEY_FILE" || { echo "no uncommented CURSOR_API_KEY=crsr_... line in $KEY_FILE" >&2; exit 1; }
SHA12="$(grep '^CURSOR_API_KEY=' "$KEY_FILE" | head -1 | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)"
echo "== switching fleet Cursor auth to account '$ACCOUNT' (sha12 $SHA12) =="

TS="$(date -u +%Y%m%d%H%M%S)"

if [[ "$SKIP_OOS" -eq 0 ]]; then
  echo "-- oos-linux --"
  mkdir -p ~/.config/cursor/auth-bak
  for f in ~/.config/cursor/auth.json ~/.hapi/cursor.env ~/.config/hapi-oos-agent.env; do
    [[ -f "$f" ]] && cp -f "$f" "$HOME/.config/cursor/auth-bak/$(basename "$f").bak-toggle-$TS"
  done
  grep '^CURSOR_API_KEY=' "$KEY_FILE" | head -1 > ~/.hapi/cursor.env
  grep '^CURSOR_API_KEY=' "$KEY_FILE" | head -1 > ~/.config/hapi-oos-agent.env
  chmod 600 ~/.hapi/cursor.env ~/.config/hapi-oos-agent.env
  ~/.hapi/pin-cursor-auth.sh
  HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 HAPI_OPERATOR_PRODUCTION_MUTATION_OVERRIDE=1 \
    sudo -E systemctl restart hapi-runner-oos.service
  sleep 2
  systemctl is-active hapi-runner-oos.service
  echo "-- smoke (oos) --"
  ( export PATH="$HOME/.local/bin:$PATH"
    set -a; source ~/.hapi/cursor.env; set +a
    timeout 75 agent -p --trust --model auto --output-format text 'reply with exactly: pong-oos' ) \
    || echo "WARNING: oos smoke test failed or timed out (>75s) — verify manually with 'agent about'"
fi

if [[ "$SKIP_PROXMOX" -eq 0 ]]; then
  echo "-- proxmox --"
  ssh -o ConnectTimeout=10 heavygee@192.168.86.73 bash -s -- "$TS" <<'REMOTE'
set -euo pipefail
TS="$1"
mkdir -p ~/.config/cursor/auth-bak
for f in ~/.config/cursor/auth.json ~/.config/cursor/api-key.env ~/.hapi/cursor.env; do
  [[ -f "$f" ]] && cp -f "$f" "$HOME/.config/cursor/auth-bak/$(basename "$f").bak-toggle-$TS"
done
REMOTE
  grep '^CURSOR_API_KEY=' "$KEY_FILE" | head -1 \
    | ssh heavygee@192.168.86.73 'cat > ~/.hapi/cursor.env && chmod 600 ~/.hapi/cursor.env'
  ssh heavygee@192.168.86.73 '~/.hapi/pin-cursor-auth.sh'
  ssh -tt heavygee@192.168.86.73 \
    'HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 HAPI_OPERATOR_PRODUCTION_MUTATION_OVERRIDE=1 sudo -E systemctl restart hapi-runner.service; sleep 2; systemctl is-active hapi-runner.service'
  echo "-- smoke (proxmox) --"
  ssh heavygee@192.168.86.73 'export PATH="$HOME/.local/bin:$PATH"; set -a; source ~/.config/cursor/api-key.env; set +a; timeout 75 agent -p --trust --model auto --output-format text "reply with exactly: pong-proxmox"' \
    || echo "WARNING: proxmox smoke test failed or timed out (>75s) — verify manually"
fi

echo "== done: fleet on account '$ACCOUNT' (sha12 $SHA12) =="
echo "Teemo NOT included: pin-cursor-auth.ps1 derives cursor.env FROM auth.json (opposite direction), and no documented runner-restart command exists yet for it. Sync manually per docs/tooling/cursor-auth-fleet-sync.md until that gap is closed."
