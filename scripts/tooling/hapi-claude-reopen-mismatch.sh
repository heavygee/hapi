#!/usr/bin/env bash
# hapi-claude-reopen-mismatch — kill+archive+reopen Claude sessions not on active slot.
#
# After hapi-claude-account-toggle (and proxmox oauth sync), live children still
# hold the old CLAUDE_CODE_OAUTH_TOKEN until respawned. This is the mechanical
# reopen step that hapi-claude-session-assess flags with "NEEDS REOPEN".
#
# Usage:
#   hapi-claude-reopen-mismatch           # only drifted / dead-pid rows
#   hapi-claude-reopen-mismatch --all     # every API-active Claude session
#   hapi-claude-reopen-mismatch --dry-run

set -euo pipefail
export PATH="/usr/bin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/hapi-claude-slots.sh
source "$SCRIPT_DIR/lib/hapi-claude-slots.sh"

DRY=0
ALL=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --all) ALL=1; shift ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -18
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

ACTIVE="$(hapi_claude_active_slot)" || { echo "no active slot" >&2; exit 2; }
WANT="$(hapi_claude_slot_sha12 "$ACTIVE")" || exit 2
echo "active=$ACTIVE want_sha12=$WANT"

python3 - "$DRY" "$ALL" "$HAPI_HOST" "$HAPI_PROXMOX_SSH" "$WANT" <<'PY'
import hashlib, json, os, signal, subprocess, sys, time, urllib.request

dry, do_all = sys.argv[1] == "1", sys.argv[2] == "1"
host, proxmox_ssh, want = sys.argv[3], sys.argv[4], sys.argv[5]

settings = json.load(open(os.path.expanduser("~/.hapi/settings.json")))
req = urllib.request.Request(
    host + "/api/auth",
    data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
jwt = json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]
H = {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}

def api(method, path, data=None, timeout=120):
    body = None if data is None else json.dumps(data).encode()
    r = urllib.request.Request(host + path, data=body, headers=H, method=method)
    try:
        return json.loads(urllib.request.urlopen(r, timeout=timeout).read()), None
    except Exception as e:
        err = getattr(e, "read", lambda: b"")()
        try:
            err = json.loads(err)
        except Exception:
            err = str(e)[:250]
        return None, err

def get(path):
    return api("GET", path)[0]

def sha_local(pid):
    try:
        for e in open(f"/proc/{pid}/environ", "rb").read().split(b"\0"):
            if e.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
                return hashlib.sha256(e.split(b"=", 1)[1]).hexdigest()[:12]
    except Exception:
        return None
    return None

sessions = get("/api/sessions?limit=500")["sessions"]
targets = []
oos_pids, prox_pids = [], []
for s in sessions:
    if not s.get("active"):
        continue
    md = (s.get("metadata") or {})
    if md.get("flavor") != "claude":
        continue
    d = get(f"/api/sessions/{s['id']}").get("session", s)
    md = d.get("metadata") or {}
    hname = md.get("host") or "?"
    pid = md.get("hostPid")
    name = md.get("name") or "?"
    sha = None
    alive = False
    if hname == "oos-linux" and pid:
        alive = os.path.exists(f"/proc/{pid}")
        sha = sha_local(int(pid)) if alive else None
    elif hname == "proxmox" and pid:
        # resolve later in batch
        prox_pids.append((s["id"], int(pid), name, hname))
        continue
    else:
        pass
    need = do_all or (not alive) or (sha and sha != want) or (alive and not sha)
    if need:
        targets.append((s["id"], name, hname, pid, sha, alive))
        if hname == "oos-linux" and pid and alive:
            oos_pids.append(int(pid))

# prox batch
if prox_pids:
    pid_list = ",".join(str(p) for _, p, _, _ in prox_pids)
    remote = (
        "import hashlib,os,json\n"
        f"pids=[{pid_list}]\n"
        "out={}\n"
        "for pid in pids:\n"
        "  try:\n"
        "    raw=open(f'/proc/{pid}/environ','rb').read()\n"
        "    sha=None\n"
        "    for e in raw.split(b'\\0'):\n"
        "      if e.startswith(b'CLAUDE_CODE_OAUTH_TOKEN='):\n"
        "        sha=hashlib.sha256(e.split(b'=',1)[1]).hexdigest()[:12]; break\n"
        "    out[str(pid)]={'alive':True,'sha':sha}\n"
        "  except Exception:\n"
        "    out[str(pid)]={'alive':False,'sha':None}\n"
        "print(json.dumps(out))\n"
    )
    try:
        proc = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", proxmox_ssh, "python3", "-"],
            input=remote, capture_output=True, text=True, timeout=60,
        )
        remote_map = json.loads(proc.stdout) if proc.returncode == 0 else {}
    except Exception:
        remote_map = {}
    for sid, pid, name, hname in prox_pids:
        info = remote_map.get(str(pid), {})
        alive = bool(info.get("alive"))
        sha = info.get("sha")
        need = do_all or (not alive) or (sha and sha != want) or (alive and not sha)
        if need:
            targets.append((sid, name, hname, pid, sha, alive))
            if alive:
                # collect for kill
                pass

print(f"targets={len(targets)} (all={do_all})")
for sid, name, hname, pid, sha, alive in targets:
    print(f"  {sid[:8]} host={hname} pid={pid} sha={sha} alive={alive} {name[:40]}")

if dry:
    print("dry-run: no kill/archive/reopen")
    sys.exit(0)

# kill
for sid, name, hname, pid, sha, alive in targets:
    if not pid or not alive:
        continue
    if hname == "oos-linux":
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass

prox_kill = [str(pid) for sid, name, hname, pid, sha, alive in targets if hname == "proxmox" and pid and alive]
if prox_kill:
    open("/tmp/hapi-claude-prox-kill.pids", "w").write("\n".join(prox_kill) + "\n")
    subprocess.check_call(["scp", "-o", "BatchMode=yes", "/tmp/hapi-claude-prox-kill.pids", f"{proxmox_ssh}:/tmp/hapi-claude-prox-kill.pids"])
    subprocess.run(
        ["ssh", "-o", "BatchMode=yes", proxmox_ssh, "bash", "-s"],
        input="""
while read -r pid; do
  [ -z "$pid" ] && continue
  if [ -d "/proc/$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; fi
done < /tmp/hapi-claude-prox-kill.pids
sleep 2
while read -r pid; do
  [ -z "$pid" ] && continue
  if [ -d "/proc/$pid" ]; then kill -KILL "$pid" 2>/dev/null || true; fi
done < /tmp/hapi-claude-prox-kill.pids
rm -f /tmp/hapi-claude-prox-kill.pids
""",
        text=True, timeout=60,
    )

time.sleep(2)
for sid, name, hname, pid, sha, alive in targets:
    if hname == "oos-linux" and pid and os.path.exists(f"/proc/{pid}"):
        try:
            os.kill(int(pid), signal.SIGKILL)
        except ProcessLookupError:
            pass

# archive + reopen (sequential reopen after archive; batch archive first)
archived = []
for sid, name, hname, pid, sha, alive in targets:
    _, err = api("POST", f"/api/sessions/{sid}/archive", {})
    if err:
        print(f"archive FAIL {sid[:8]} {err}")
    else:
        archived.append(sid)
        print(f"archived {sid[:8]}")

ok = fail = 0
for sid in archived:
    resp, err = api("POST", f"/api/sessions/{sid}/reopen", {})
    if err:
        print(f"reopen FAIL {sid[:8]} {err}")
        # one retry after brief pause
        time.sleep(2)
        resp, err = api("POST", f"/api/sessions/{sid}/reopen", {})
    if err:
        print(f"reopen FAIL2 {sid[:8]} {err}")
        fail += 1
    else:
        print(f"reopen OK {sid[:8]} -> {(resp.get('sessionId') or sid)[:8]}")
        ok += 1
    time.sleep(0.5)

print(f"== reopen-mismatch ok={ok} fail={fail} ==")
sys.exit(1 if fail else 0)
PY
