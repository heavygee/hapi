#!/usr/bin/env bash
# hapi-claude-auth-audit — fleet Claude OAuth coherence (host files + runner env).
#
# Cursor twin: hapi-cursor-auth-audit.sh
# READ-ONLY (remote via SSH). Never prints token material — sha12 only.
# Canon: docs/tooling/claude-auth-slots.md
#
# Exit codes:
#   0  oos + proxmox match active slot sha12 across canon files + runner env
#   1  drift detected
#   2  usage / connectivity error
#
# Usage:
#   hapi-claude-auth-audit
#   hapi-claude-auth-audit --local-only
#   hapi-claude-auth-audit --json
#   hapi-claude-auth-audit --quiet

set -euo pipefail
export PATH="/usr/bin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"
# shellcheck source=lib/hapi-claude-oauth-dropin.sh
source "$SCRIPT_DIR/lib/hapi-claude-oauth-dropin.sh"

LOCAL_ONLY=0
FORMAT=table
QUIET=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local-only) LOCAL_ONLY=1; shift ;;
        --json) FORMAT=json; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -25
            exit 0
            ;;
        *) echo "hapi-claude-auth-audit: unknown arg: $1" >&2; exit 2 ;;
    esac
done

ACTIVE="$(hapi_claude_active_slot 2>/dev/null || true)"
[[ -n "$ACTIVE" ]] || { echo "hapi-claude-auth-audit: no active slot" >&2; exit 2; }
WANT="$(hapi_claude_slot_sha12 "$ACTIVE")" || { echo "hapi-claude-auth-audit: cannot read slot $ACTIVE" >&2; exit 2; }

runner_sha_local() {
    local unit="$1" pid tok=""
    pid="$(systemctl show "$unit" -p MainPID --value 2>/dev/null || echo 0)"
    [[ -n "$pid" && "$pid" != 0 && -d "/proc/$pid" ]] || { echo ""; return 0; }
    python3 - "$pid" <<'PY'
import hashlib, os, sys
pid = int(sys.argv[1])
tok = ""
for e in open(f"/proc/{pid}/environ", "rb").read().split(b"\0"):
    if e.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
        tok = e.split(b"=", 1)[1].decode()
        break
print(hashlib.sha256(tok.encode()).hexdigest()[:12] if tok else "")
PY
}

file_sha() {
    local f="$1" tok=""
    if [[ -r "$f" ]]; then
        tok="$(hapi_claude_read_token "$f" 2>/dev/null || true)"
    elif [[ -f "$f" ]] && sudo -n true 2>/dev/null; then
        # Canon under /etc/hapi is root:root 0600 — same as toggle's sudo path.
        tok="$(sudo -n cat -- "$f" 2>/dev/null | grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' | tail -n1 | cut -d= -f2- || true)"
    fi
    [[ -n "$tok" ]] && hapi_claude_sha12 "$tok" || echo ""
}

ROWS=()
add_row() {
    # host surface value status
    ROWS+=("$1|$2|$3|$4")
}

# --- oos ---
CANON="$(hapi_claude_oauth_system_token_file)"
LEGACY="$HOME/.hapi/claude-setup-token.env"
add_row "oos-linux" "active-marker" "$ACTIVE" "ok"
add_row "oos-linux" "slot:$ACTIVE" "$WANT" "ok"
cs="$(file_sha "$CANON")"
[[ "$cs" == "$WANT" ]] && st=ok || st=drift
add_row "oos-linux" "canon:$CANON" "${cs:-missing}" "$st"
ls="$(file_sha "$LEGACY")"
if [[ -n "$ls" ]]; then
    [[ "$ls" == "$WANT" ]] && st=ok || st=drift
    add_row "oos-linux" "legacy:~/.hapi/claude-setup-token.env" "$ls" "$st"
fi
rs="$(runner_sha_local hapi-runner-oos.service)"
[[ "$rs" == "$WANT" ]] && st=ok || st=drift
add_row "oos-linux" "runner:hapi-runner-oos" "${rs:-missing}" "$st"

DRIFT=0
UNREACH=0

if [[ "$LOCAL_ONLY" -eq 0 ]]; then
    rem="$(ssh -o ConnectTimeout=12 -o BatchMode=yes "$HAPI_PROXMOX_SSH" 'bash -s' <<'REMOTE' || true
set -euo pipefail
python3 - <<'PY'
import hashlib, os, subprocess
from pathlib import Path

def sha12(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()[:12]

def file_sha(path: str):
    p = Path(path).expanduser()
    if not p.is_file():
        return ""
    for line in p.read_text().splitlines():
        if line.startswith("CLAUDE_CODE_OAUTH_TOKEN="):
            return sha12(line.split("=", 1)[1].strip())
    return ""

oauth = file_sha(str(Path.home() / ".config/claude/oauth.env"))
pid = subprocess.check_output(
    ["systemctl", "show", "hapi-runner.service", "-p", "MainPID", "--value"],
    text=True,
).strip()
runner = ""
if pid and pid != "0" and Path(f"/proc/{pid}").exists():
    for e in open(f"/proc/{pid}/environ", "rb").read().split(b"\0"):
        if e.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
            runner = sha12(e.split(b"=", 1)[1].decode())
            break
print(f"oauth={oauth or 'missing'}")
print(f"runner={runner or 'missing'}")
PY
REMOTE
)"
    if [[ -z "$rem" ]]; then
        UNREACH=1
        add_row "proxmox" "ssh" "unreachable" "error"
    else
        po="$(grep '^oauth=' <<<"$rem" | cut -d= -f2-)"
        pr="$(grep '^runner=' <<<"$rem" | cut -d= -f2-)"
        [[ "$po" == "$WANT" ]] && st=ok || st=drift
        add_row "proxmox" "oauth:~/.config/claude/oauth.env" "$po" "$st"
        [[ "$pr" == "$WANT" ]] && st=ok || st=drift
        add_row "proxmox" "runner:hapi-runner" "$pr" "$st"
    fi
fi

for row in "${ROWS[@]}"; do
    IFS='|' read -r host surface val status <<<"$row"
    [[ "$status" == "drift" ]] && DRIFT=1
    [[ "$status" == "error" ]] && UNREACH=1
done

if [[ "$FORMAT" == "json" ]]; then
    python3 - "$WANT" "$ACTIVE" "$DRIFT" "${ROWS[@]}" <<'PY'
import json, sys
want, active, drift = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
rows = []
for raw in sys.argv[4:]:
    host, surface, val, status = raw.split("|", 3)
    rows.append({"host": host, "surface": surface, "sha12": val, "status": status})
print(json.dumps({"active": active, "want_sha12": want, "drift": drift, "rows": rows}, indent=2))
PY
else
    echo "active=$ACTIVE want_sha12=$WANT"
    printf '%-10s %-42s %-12s %s\n' "HOST" "SURFACE" "SHA12" "STATUS"
    for row in "${ROWS[@]}"; do
        IFS='|' read -r host surface val status <<<"$row"
        if [[ "$QUIET" -eq 1 && "$status" == "ok" ]]; then
            continue
        fi
        flag=""
        [[ "$status" == "drift" ]] && flag=" <-- DRIFT"
        printf '%-10s %-42s %-12s %s%s\n' "$host" "$surface" "$val" "$status" "$flag"
    done
fi

if [[ "$UNREACH" -eq 1 ]]; then
    exit 2
fi
exit "$([[ "$DRIFT" -eq 1 ]] && echo 1 || echo 0)"
