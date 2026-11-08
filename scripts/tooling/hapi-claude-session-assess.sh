#!/usr/bin/env bash
# hapi-claude-session-assess — per-SESSION Claude token audit (live process env).
#
# Cursor twin: hapi-cursor-session-assess.sh
#
# hapi-claude-auth-audit checks host files + runner env. Live Claude children
# keep the token they inherited at spawn until kill+archive+reopen. This script
# closes that gap (and replaces "local /proc only" zombie false-positives in
# the older hapi-claude-assess.sh for proxmox rows).
#
# READ-ONLY. Never prints token material — sha12 only.
#
# Exit codes: 0 all match active slot, 1 drift found, 2 usage/connectivity error.
# Usage: hapi-claude-session-assess [--json] [--quiet]

set -euo pipefail
export PATH="/usr/bin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

FORMAT=table
QUIET=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) FORMAT=json; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -20
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

ACTIVE="$(hapi_claude_active_slot 2>/dev/null || true)"
[[ -n "$ACTIVE" ]] || { echo "no active slot" >&2; exit 2; }
WANT="$(hapi_claude_slot_sha12 "$ACTIVE")" || { echo "cannot read slot $ACTIVE" >&2; exit 2; }

python3 - "$FORMAT" "$QUIET" "$HAPI_HOST" "$HAPI_PROXMOX_SSH" "$WANT" "$ACTIVE" <<'PY'
import hashlib, json, os, subprocess, sys, urllib.request

fmt, quiet = sys.argv[1], sys.argv[2] == "1"
host, proxmox_ssh, want, active = sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]

settings = json.load(open(os.path.expanduser("~/.hapi/settings.json")))
req = urllib.request.Request(
    host + "/api/auth",
    data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    jwt = json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]
except Exception as e:
    print(f"hub auth failed: {e}", file=sys.stderr)
    sys.exit(2)

def get(path):
    r = urllib.request.Request(host + path, headers={"Authorization": f"Bearer {jwt}"})
    return json.loads(urllib.request.urlopen(r, timeout=20).read())

def sha_from_environ(raw: bytes):
    for e in raw.split(b"\0"):
        if e.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
            return hashlib.sha256(e.split(b"=", 1)[1]).hexdigest()[:12]
    return None

sessions = get("/api/sessions?limit=500")["sessions"]
active_claude = []
for s in sessions:
    if not s.get("active"):
        continue
    md = s.get("metadata") or {}
    if md.get("flavor") != "claude":
        continue
    d = get(f"/api/sessions/{s['id']}").get("session", s)
    md = d.get("metadata") or {}
    active_claude.append({
        "id": s["id"],
        "host": md.get("host") or "?",
        "pid": md.get("hostPid"),
        "name": (md.get("name") or "?")[:50],
    })

oos = [r for r in active_claude if r["host"] == "oos-linux"]
prox = [r for r in active_claude if r["host"] == "proxmox"]
other = [r for r in active_claude if r["host"] not in ("oos-linux", "proxmox")]

rows = []
unreachable = False

for r in oos:
    pid = r["pid"]
    sha, status = None, "dead"
    if pid and os.path.exists(f"/proc/{pid}"):
        try:
            sha = sha_from_environ(open(f"/proc/{pid}/environ", "rb").read())
            status = "ok" if sha else "no-token"
        except Exception:
            status = "dead"
    rows.append({**r, "sha12": sha, "status": status})

if prox:
    pids = [str(r["pid"]) for r in prox if r.get("pid")]
    remote = (
        "import hashlib,os,json\n"
        "pids=os.environ.get('PIDS','').split(',')\n"
        "out={}\n"
        "for pid in pids:\n"
        "  if not pid: continue\n"
        "  try:\n"
        "    raw=open(f'/proc/{pid}/environ','rb').read()\n"
        "    sha=None\n"
        "    for e in raw.split(b'\\0'):\n"
        "      if e.startswith(b'CLAUDE_CODE_OAUTH_TOKEN='):\n"
        "        sha=hashlib.sha256(e.split(b'=',1)[1]).hexdigest()[:12]; break\n"
        "    out[pid]=sha or 'no-token'\n"
        "  except Exception:\n"
        "    out[pid]='dead'\n"
        "print(json.dumps(out))\n"
    )
    try:
        proc = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", proxmox_ssh,
             f'PIDS="{",".join(pids)}" python3 -'],
            input=remote, capture_output=True, text=True, timeout=60,
        )
        remote_map = json.loads(proc.stdout) if proc.returncode == 0 and proc.stdout.strip() else {}
        if proc.returncode != 0:
            unreachable = True
    except Exception:
        remote_map, unreachable = {}, True
    for r in prox:
        v = remote_map.get(str(r["pid"]))
        if v and len(v) == 12:
            sha, status = v, "ok"
        else:
            sha, status = None, (v or "unreachable")
        rows.append({**r, "sha12": sha, "status": status})

for r in other:
    rows.append({**r, "sha12": None, "status": "unsupported-host"})

drift = any(r["sha12"] and r["sha12"] != want for r in rows)
dead = sum(1 for r in rows if r["status"] in ("dead", "unreachable", "no-token"))

if fmt == "json":
    print(json.dumps({
        "active_slot": active,
        "want_sha12": want,
        "drift": drift,
        "rows": rows,
    }, indent=2))
else:
    print(f"active_slot={active} want_sha12={want}")
    print(f"{'HOST':<10} {'SESSION':<10} {'PID':>9} {'TOKEN':<12} {'STATUS':<12} NAME")
    for r in rows:
        mismatch = r["sha12"] and r["sha12"] != want
        if quiet and not mismatch and r["status"] == "ok":
            continue
        flag = " <-- NEEDS REOPEN" if mismatch else ""
        print(f"{r['host']:<10} {r['id'][:8]:<10} {str(r['pid'] or '-'):>9} {(r['sha12'] or '-'):<12} {r['status']:<12} {r['name']}{flag}")
    need = [r for r in rows if r["sha12"] and r["sha12"] != want]
    print(f"\n{len(rows)} active Claude; {len(need)} wrong token; {dead} dead/unreachable.")
    if need:
        print("Reopen with: hapi-claude-reopen-mismatch")

if unreachable:
    sys.exit(2)
sys.exit(1 if drift else 0)
PY
