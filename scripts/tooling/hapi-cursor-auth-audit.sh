#!/usr/bin/env bash
# hapi-cursor-auth-audit — fleet Cursor Agent credential coherence check.
#
# READ-ONLY (remote: runs audit Python via SSH). Never prints apiKey material — sha12 only.
# Canon: docs/tooling/cursor-auth-fleet-sync.md
#
# Exit codes:
#   0  all probed hosts MATCH canonical auth.json apiKey across derived envs + runner
#   1  drift detected on one or more hosts
#   2  usage / connectivity error
#
# Usage:
#   hapi-cursor-auth-audit              # local + fleet SSH hosts
#   hapi-cursor-auth-audit --local-only # this host only
#   hapi-cursor-auth-audit --json       # machine-readable rows
#   hapi-cursor-auth-audit --quiet      # only drift rows; still exits non-zero on drift

set -euo pipefail

LOCAL_ONLY=0
FORMAT=table
QUIET=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local-only) LOCAL_ONLY=1; shift ;;
        --json)       FORMAT=json; shift ;;
        --quiet)      QUIET=1; shift ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -35
            exit 0
            ;;
        *) echo "hapi-cursor-auth-audit: unknown arg: $1" >&2; exit 2 ;;
    esac
done

# host_id|ssh_target|runner_unit|extra_env_paths|platform (linux|windows)
FLEET_HOSTS=(
    "oos-linux|local|hapi-runner-oos.service|.config/hapi-oos-agent.env|linux"
    "proxmox|heavygee@192.168.86.73|hapi-runner.service||linux"
    "teemo|teemo|bun||windows"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIN_AUDIT_PS1="${SCRIPT_DIR}/windows/hapi-cursor-auth-audit.ps1"

AUDIT_PY=$(cat <<'PY'
import json
import hashlib
import os
import subprocess
import sys
from pathlib import Path

def sha12_key(key: str | None) -> str | None:
    if not key:
        return None
    return hashlib.sha256(key.encode()).hexdigest()[:12]

def read_env_key(path: Path) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith("CURSOR_API_KEY=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip()
    return None

def lsattr_immutable(path: Path) -> bool:
    if not path.exists():
        return False
    r = subprocess.run(["lsattr", str(path)], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout:
        return False
    return "i" in r.stdout.split()[0]

def runner_key_sha12(unit: str) -> tuple[str | None, str]:
    try:
        pid = int(
            subprocess.check_output(
                ["systemctl", "show", unit, "-p", "MainPID", "--value"],
                text=True,
            ).strip()
        )
    except Exception:
        return None, "no_unit"
    if pid <= 0:
        return None, "inactive"
    try:
        raw = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return None, "no_environ"
    env = dict(
        x.split(b"=", 1)
        for x in raw.split(b"\0")
        if b"=" in x
    )
    k = env.get(b"CURSOR_API_KEY", b"").decode()
    return sha12_key(k), "ok"

home = Path.home()
auth_path = home / ".config/cursor/auth.json"
auth_key = None
auth_h = None
if auth_path.exists():
    try:
        auth_key = json.loads(auth_path.read_text()).get("apiKey")
        auth_h = sha12_key(auth_key)
    except Exception:
        auth_h = None

rows: list[dict] = []
canonical = sha12_key(read_env_key(home / ".hapi/cursor.env")) or auth_h

def add_row(check: str, sha: str | None, status: str) -> None:
    rows.append({"check": check, "sha12": sha or "-", "status": status})

add_row("auth.json", auth_h, "MATCH" if auth_h and auth_h == canonical else ("DIFFERENT" if auth_h else "missing"))

cursor_h = sha12_key(read_env_key(home / ".hapi/cursor.env"))
add_row(
    "cursor.env",
    cursor_h,
    "MATCH" if cursor_h and cursor_h == canonical else ("DIFFERENT" if cursor_h else "missing"),
)

api_h = sha12_key(read_env_key(home / ".config/cursor/api-key.env"))
if api_h is not None:
    add_row(
        "api-key.env",
        api_h,
        "MATCH" if api_h == canonical else "DIFFERENT",
    )
else:
    add_row("api-key.env", None, "missing")

for extra in os.environ.get("HAPI_CURSOR_EXTRA_ENVS", "").split(","):
    extra = extra.strip()
    if not extra:
        continue
    p = home / extra
    h = sha12_key(read_env_key(p))
    label = Path(extra).name
    add_row(
        label,
        h,
        "MATCH" if h and h == canonical else ("DIFFERENT" if h else "missing"),
    )

unit = os.environ.get("HAPI_CURSOR_RUNNER_UNIT", "hapi-runner.service")
runner_h, runner_state = runner_key_sha12(unit)
if runner_state == "ok" and runner_h:
    add_row(
        f"runner({unit})",
        runner_h,
        "MATCH" if runner_h == canonical else "DIFFERENT",
    )
else:
    add_row(f"runner({unit})", None, runner_state)

pin = home / ".hapi/pin-cursor-auth.sh"
add_row("pin-script", None, "present" if pin.is_file() else "missing")

add_row(
    "auth-immutable",
    None,
    "yes" if lsattr_immutable(auth_path) else "no",
)

drift = any(r["status"] == "DIFFERENT" for r in rows)
print(json.dumps({"canonical_sha12": canonical, "rows": rows, "drift": drift}))
PY
)

run_local_audit() {
    local host="$1" unit="$2" extra_envs="$3"
    HAPI_CURSOR_RUNNER_UNIT="$unit" HAPI_CURSOR_EXTRA_ENVS="$extra_envs" python3 -c "$AUDIT_PY"
}

run_remote_audit() {
    local host="$1" ssh_target="$2" unit="$3" extra_envs="$4" platform="$5"
    if ! ssh -o ConnectTimeout=12 -o BatchMode=yes "$ssh_target" \
        "HAPI_CURSOR_RUNNER_UNIT='$unit' HAPI_CURSOR_EXTRA_ENVS='$extra_envs' python3 -c $(printf '%q' "$AUDIT_PY")" 2>/dev/null; then
        echo "{\"canonical_sha12\":null,\"rows\":[{\"check\":\"ssh\",\"sha12\":\"-\",\"status\":\"unreachable\"}],\"drift\":true}"
        return 1
    fi
}

run_windows_remote_audit() {
    local ssh_target="$1"
    if [[ ! -f "$WIN_AUDIT_PS1" ]]; then
        echo "hapi-cursor-auth-audit: missing $WIN_AUDIT_PS1" >&2
        echo "{\"canonical_sha12\":null,\"rows\":[{\"check\":\"audit-script\",\"sha12\":\"-\",\"status\":\"missing\"}],\"drift\":true}"
        return 1
    fi
    if ! scp -q -o ConnectTimeout=12 -o BatchMode=yes "$WIN_AUDIT_PS1" "${ssh_target}:.hapi/hapi-cursor-auth-audit.ps1" 2>/dev/null; then
        echo "{\"canonical_sha12\":null,\"rows\":[{\"check\":\"ssh\",\"sha12\":\"-\",\"status\":\"unreachable\"}],\"drift\":true}"
        return 1
    fi
    if ! ssh -o ConnectTimeout=12 -o BatchMode=yes "$ssh_target" \
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .hapi/hapi-cursor-auth-audit.ps1' 2>/dev/null; then
        echo "{\"canonical_sha12\":null,\"rows\":[{\"check\":\"ssh\",\"sha12\":\"-\",\"status\":\"unreachable\"}],\"drift\":true}"
        return 1
    fi
}

RESULTS=()
DRIFT=0
UNREACHABLE=0

for entry in "${FLEET_HOSTS[@]}"; do
    IFS='|' read -r host_id ssh_target unit extra_envs platform <<<"$entry"
    platform="${platform:-linux}"

    if [[ "$LOCAL_ONLY" -eq 1 && "$ssh_target" != "local" ]]; then
        continue
    fi

    if [[ "$ssh_target" == "local" ]]; then
        payload=$(run_local_audit "$host_id" "$unit" "$extra_envs") || true
    else
        if [[ "$LOCAL_ONLY" -eq 1 ]]; then
            continue
        fi
        if [[ "$platform" == "windows" ]]; then
            if ! payload=$(run_windows_remote_audit "$ssh_target"); then
                UNREACHABLE=1
                DRIFT=1
            fi
        elif ! payload=$(run_remote_audit "$host_id" "$ssh_target" "$unit" "$extra_envs" "$platform"); then
            UNREACHABLE=1
            DRIFT=1
        fi
    fi

    [[ -n "${payload:-}" ]] || continue
    RESULTS+=("$host_id|$payload")
    if echo "$payload" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(1 if d.get('drift') else 0)"; then
        :
    else
        DRIFT=1
    fi
done

export HAPI_CURSOR_AUDIT_QUIET="$QUIET"
export HAPI_CURSOR_AUDIT_FORMAT="$FORMAT"
python3 - <<'PY' "${RESULTS[@]}"
import json
import os
import sys

quiet = os.environ.get("HAPI_CURSOR_AUDIT_QUIET") == "1"
fmt = os.environ.get("HAPI_CURSOR_AUDIT_FORMAT", "table")
out = []
for raw in sys.argv[1:]:
    host, payload = raw.split("|", 1)
    d = json.loads(payload)
    out.append({"host": host, **d})

if fmt == "json":
    print(json.dumps(out, indent=2))
    sys.exit(0)

print(f"{'HOST':<12} {'CHECK':<22} {'SHA12':<14} STATUS")
print(f"{'----':<12} {'-----':<22} {'-----':<14} ------")
for block in out:
    host = block["host"]
    for row in block["rows"]:
        status = row["status"]
        check = row["check"]
        if quiet:
            if status in ("MATCH", "ok", "present"):
                continue
            if status == "no" and check == "auth-immutable":
                continue
            if status == "missing" and check == "api-key.env":
                continue
        print(f"{host:<12} {check:<22} {row['sha12']:<14} {status}")
PY

if [[ "$UNREACHABLE" -eq 1 ]]; then
    exit 2
fi
if [[ "$DRIFT" -eq 1 ]]; then
    exit 1
fi
exit 0
