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

python3 - "$DRY" "$ALL" "$HAPI_HOST" "$HAPI_PROXMOX_SSH" "$WANT" "$SCRIPT_DIR/lib" <<'PY'
import hashlib, json, os, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

dry, do_all = sys.argv[1] == "1", sys.argv[2] == "1"
host, proxmox_ssh, want = sys.argv[3], sys.argv[4], sys.argv[5]
LIB_DIR = sys.argv[6]

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

# kill — verify, do not assume. `kill`/SIGKILL returning means the signal was
# delivered, never that the process died. One authored algorithm
# (lib/hapi-kill-verify.sh: SIGTERM -> poll -> SIGKILL -> poll -> report),
# serialized via `declare -f` and run for REAL on both hosts — locally via
# `bash -c` for oos-linux, over SSH for proxmox — so there is exactly one
# copy of the grace-period/escalation logic, not a hand-duplicated Python
# twin that can silently drift from it.
KILL_VERIFY_TIMEOUT_S = float(os.environ.get("HAPI_KILL_VERIFY_TIMEOUT_S", "5"))
KILL_VERIFY_POLL_S = float(os.environ.get("HAPI_KILL_VERIFY_POLL_S", "0.2"))

lib_load = subprocess.run(
    ["bash", "-c", f"source {LIB_DIR}/hapi-kill-verify.sh && declare -f hapi_kill_verify_wait_dead"],
    capture_output=True, text=True,
)
if lib_load.returncode != 0 or not lib_load.stdout.strip():
    print(f"FATAL: cannot load {LIB_DIR}/hapi-kill-verify.sh: {lib_load.stderr.strip()}", file=sys.stderr)
    sys.exit(2)
KILL_VERIFY_LIB_SRC = lib_load.stdout

def kill_verify_script(pids):
    pid_block = "\n".join(pids)
    return f"""
set -u
{KILL_VERIFY_LIB_SRC}
while read -r pid; do
  [ -z "$pid" ] && continue
  if [ -d "/proc/$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; fi
done <<'PIDLIST'
{pid_block}
PIDLIST
while read -r pid; do
  [ -z "$pid" ] && continue
  if ! hapi_kill_verify_wait_dead "$pid" {KILL_VERIFY_TIMEOUT_S} {KILL_VERIFY_POLL_S}; then
    if [ -d "/proc/$pid" ]; then kill -KILL "$pid" 2>/dev/null || true; fi
    if ! hapi_kill_verify_wait_dead "$pid" {KILL_VERIFY_TIMEOUT_S} {KILL_VERIFY_POLL_S}; then
      echo "SURVIVOR $pid"
    fi
  fi
done <<'PIDLIST'
{pid_block}
PIDLIST
echo KILLVERIFY_DONE
"""

def kill_verify(pids, ssh_target=None):
    """Run the shared kill-verify algorithm for real (local bash or over SSH).
    Fails closed on ANYTHING short of clean completion — a crashed ssh, a
    timeout, a dropped connection mid-batch, or a nonzero exit all treat
    every requested pid as an unverified survivor. The explicit
    KILLVERIFY_DONE marker (not just returncode==0) is what proves the
    script actually finished every pid in the batch rather than exiting
    partway through with only some SURVIVOR lines printed — a partial run
    that silently excluded some unprocessed pids from the survivor set
    would recreate the exact 'two agents on one session id' bug this
    function exists to prevent."""
    if not pids:
        return set()
    # One bash-level SIGTERM wait + one SIGKILL wait per pid, sequential;
    # size the subprocess bound to the batch instead of a fixed guess so a
    # legitimately large --all run doesn't get marked all-survivors by an
    # unrelated timeout.
    budget = max(60, len(pids) * 2 * (KILL_VERIFY_TIMEOUT_S + KILL_VERIFY_POLL_S) + 20)
    script = kill_verify_script(pids)
    try:
        if ssh_target:
            result = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", ssh_target, "bash", "-s"],
                input=script, text=True, capture_output=True, timeout=budget,
            )
        else:
            result = subprocess.run(
                ["bash", "-c", script], text=True, capture_output=True, timeout=budget,
            )
    except Exception as e:
        print(f"FATAL kill-verify run failed ({ssh_target or 'local'}): {e} — treating all {len(pids)} pid(s) as unverified survivors", file=sys.stderr)
        return set(pids)
    stdout = result.stdout or ""
    if result.returncode not in (0, None) or "KILLVERIFY_DONE" not in stdout:
        print(f"FATAL kill-verify script did not complete cleanly ({ssh_target or 'local'}, rc={result.returncode}): {(result.stderr or '').strip()[:200]} — treating all {len(pids)} pid(s) as unverified survivors", file=sys.stderr)
        return set(pids)
    survivors = set()
    for line in stdout.splitlines():
        if line.startswith("SURVIVOR "):
            survivors.add(line.split(" ", 1)[1].strip())
    return survivors

oos_kill = [str(pid) for sid, name, hname, pid, sha, alive in targets if hname == "oos-linux" and pid and alive]
prox_kill = [str(pid) for sid, name, hname, pid, sha, alive in targets if hname == "proxmox" and pid and alive]

# Independent pid sets on independent hosts — run concurrently so the two
# grace-period waits overlap instead of serializing.
with ThreadPoolExecutor(max_workers=2) as pool:
    oos_future = pool.submit(kill_verify, oos_kill)
    prox_future = pool.submit(kill_verify, prox_kill, ssh_target=proxmox_ssh)
    oos_survivors = oos_future.result()
    prox_survivors = prox_future.result()

survivor_sids = set()
for sid, name, hname, pid, sha, alive in targets:
    if not pid or not alive:
        continue
    if (hname == "oos-linux" and str(pid) in oos_survivors) or (hname == "proxmox" and str(pid) in prox_survivors):
        survivor_sids.add(sid)
        print(f"SURVIVOR {sid[:8]} host={hname} pid={pid} — old process did NOT die, refusing archive+reopen for this session {name[:40]}")

# archive + reopen (sequential reopen after archive; batch archive first) —
# never for a session whose old process is a confirmed survivor.
archived = []
for sid, name, hname, pid, sha, alive in targets:
    if sid in survivor_sids:
        continue
    _, err = api("POST", f"/api/sessions/{sid}/archive", {})
    if err:
        print(f"archive FAIL {sid[:8]} {err}")
    else:
        archived.append(sid)
        print(f"archived {sid[:8]}")

ok = 0
fail = len(survivor_sids)
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

print(f"== reopen-mismatch ok={ok} fail={fail} survivors={len(survivor_sids)} ==")
sys.exit(1 if fail else 0)
PY
