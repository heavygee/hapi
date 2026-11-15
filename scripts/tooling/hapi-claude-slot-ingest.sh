#!/usr/bin/env bash
# hapi-claude-slot-ingest — capture a Claude account into ~/.hapi/claude-auth/<slot>/.
#
# Use for personal Ultra (or any new subscription) without clobbering the
# currently-active Teams interactive login. Runs login + setup-token under an
# isolated CLAUDE_CONFIG_DIR, then installs:
#   ~/.hapi/claude-auth/<slot>/.credentials.json
#   ~/.hapi/claude-auth/<slot>/claude-setup-token.env
#
# Usage:
#   hapi-claude-slot-ingest ultra              # guided interactive capture
#   hapi-claude-slot-ingest ultra --from-dir /path/to/claude-config
#   hapi-claude-slot-ingest ultra --token-file /path/token.env --cred-file /path/.credentials.json
#
# After ingest: hapi-claude-usage ultra && hapi-claude-account-toggle ultra

set -euo pipefail
export PATH="/usr/bin:/bin:${HOME}/.local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

SLOT="${1:-}"
[[ -n "$SLOT" ]] || {
    echo "Usage: $0 <slot> [--from-dir DIR | --token-file F --cred-file F]" >&2
    exit 1
}
shift || true

FROM_DIR=""
TOKEN_FILE=""
CRED_FILE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-dir) FROM_DIR="$2"; shift 2 ;;
        --token-file) TOKEN_FILE="$2"; shift 2 ;;
        --cred-file) CRED_FILE="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -20
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

hapi_claude_slot_name_ok "$SLOT" || exit 1
SLOT_DIR="$HAPI_CLAUDE_AUTH_ROOT/$SLOT"
ISOLATED="$SLOT_DIR/capture-config"
DEST_CRED="$(hapi_claude_slot_cred_file "$SLOT")"
DEST_TOKEN="$(hapi_claude_slot_token_file "$SLOT")"

mkdir -p "$SLOT_DIR"
chmod 700 "$SLOT_DIR"

install_pair() {
    local cred_src="$1" token_src="$2"
    [[ -f "$cred_src" ]] || { echo "missing credentials: $cred_src" >&2; exit 1; }
    [[ -f "$token_src" ]] || { echo "missing token file: $token_src" >&2; exit 1; }
    # Validate JSON + nonempty token before overwrite
    python3 - "$cred_src" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
oauth = d.get("claudeAiOauth") or {}
if not oauth.get("accessToken"):
    sys.stderr.write("ERROR: credentials lack claudeAiOauth.accessToken\n")
    sys.exit(1)
print("subscriptionType=%s rateLimitTier=%s" % (
    oauth.get("subscriptionType"), oauth.get("rateLimitTier")))
PY
    grep -qE '^CLAUDE_CODE_OAUTH_TOKEN=.' "$token_src" || {
        echo "ERROR: $token_src needs CLAUDE_CODE_OAUTH_TOKEN=…" >&2
        exit 1
    }
    install -m 600 "$cred_src" "$DEST_CRED"
    # Normalize to a single assignment line
    tok="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$token_src" | tail -n1)"
    printf '%s\n' "$tok" >"$DEST_TOKEN"
    chmod 600 "$DEST_TOKEN"
    sha="$(hapi_claude_slot_sha12 "$SLOT")"
    echo "== ingested slot '$SLOT' sha12=$sha dest=$SLOT_DIR =="
    echo "Next: hapi-claude-usage $SLOT"
    echo "      hapi-claude-account-toggle $SLOT   # when you want the fleet on it"
}

if [[ -n "$TOKEN_FILE" || -n "$CRED_FILE" ]]; then
    [[ -n "$TOKEN_FILE" && -n "$CRED_FILE" ]] || {
        echo "--token-file and --cred-file must be used together" >&2
        exit 2
    }
    install_pair "$CRED_FILE" "$TOKEN_FILE"
    exit 0
fi

if [[ -n "$FROM_DIR" ]]; then
    [[ -f "$FROM_DIR/.credentials.json" ]] || {
        echo "missing $FROM_DIR/.credentials.json" >&2
        exit 1
    }
    if [[ -f "$FROM_DIR/claude-setup-token.env" ]]; then
        install_pair "$FROM_DIR/.credentials.json" "$FROM_DIR/claude-setup-token.env"
    else
        echo "ERROR: $FROM_DIR has credentials but no claude-setup-token.env" >&2
        echo "Create it with:  CLAUDE_CODE_OAUTH_TOKEN=<from setup-token>  in that file" >&2
        exit 1
    fi
    exit 0
fi

# --- Interactive guided capture ---
mkdir -p "$ISOLATED"
chmod 700 "$ISOLATED"

cat <<EOF

== Claude slot ingest: $SLOT ==

This uses an *isolated* Claude config so your current Teams login on
~/.claude/ is NOT overwritten:

  CLAUDE_CONFIG_DIR=$ISOLATED

Do this on a machine with a browser (oos is fine if you can open the OAuth URL).

STEPS (run these yourself in a normal terminal — not via me pasting secrets):

  1) export CLAUDE_CONFIG_DIR=$ISOLATED
  2) claude /login
       → complete browser OAuth as the **personal Ultra** account
       → confirm /usage shows Ultra / personal, not Teams
  3) Still with CLAUDE_CONFIG_DIR set:
       claude setup-token
       → copy the printed long-lived token (sk-ant-oat01-…)
  4) Write the token file (paste token once; do not echo into chat):

       umask 077
       printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' 'PASTE_TOKEN_HERE' \\
         > $ISOLATED/claude-setup-token.env
       chmod 600 $ISOLATED/claude-setup-token.env

  5) Tell me when done, or run:

       hapi-claude-slot-ingest $SLOT --from-dir $ISOLATED

After ingest you can smoke without switching the fleet:

  hapi-claude-usage $SLOT

EOF

# If capture already complete, install now
if [[ -f "$ISOLATED/.credentials.json" && -f "$ISOLATED/claude-setup-token.env" ]]; then
    echo "Found completed capture under $ISOLATED — installing."
    install_pair "$ISOLATED/.credentials.json" "$ISOLATED/claude-setup-token.env"
    exit 0
fi

echo "Waiting on you for steps 1–4 above (isolated dir is ready)."
exit 0
