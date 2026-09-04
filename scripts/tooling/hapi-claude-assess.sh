#!/usr/bin/env bash
# hapi-claude-assess.sh — report API-active Claude sessions vs live hostPid.
#
# Usage: hapi-claude-assess.sh
set -euo pipefail
export PATH="/usr/bin:/bin:${PATH:-}"

python3 <<'PY'
import json, os, urllib.request

settings = json.load(open(os.path.expanduser("~/.hapi/settings.json")))
host = os.environ.get("HAPI_HOST", "http://127.0.0.1:3006")
req = urllib.request.Request(host + "/api/auth", data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(), headers={"Content-Type": "application/json"}, method="POST")
jwt = json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]

def get(path):
    return json.loads(urllib.request.urlopen(urllib.request.Request(host + path, headers={"Authorization": f"Bearer {jwt}"}), timeout=15).read())

sessions = get("/api/sessions?limit=500")["sessions"]
claude = [s for s in sessions if s.get("metadata", {}).get("flavor") == "claude"]
active = sorted([s for s in claude if s.get("active")], key=lambda x: -(x.get("updatedAt") or 0))

ok = zombie = 0
print(f"API active claude: {len(active)}")
print(f"{'id':8} {'state':8} {'pid':>8} name")
print("-" * 72)
for s in active:
    sid = s["id"]
    detail = get(f"/api/sessions/{sid}").get("session", s)
    hp = detail.get("metadata", {}).get("hostPid")
    alive = hp and os.path.exists(f"/proc/{hp}")
    name = (detail.get("metadata", {}).get("name") or "?")[:50]
    if alive:
        ok += 1
        state = "OK"
    else:
        zombie += 1
        state = "ZOMBIE"
    print(f"{sid[:8]:8} {state:8} {str(hp or '-'):>8} {name}")

inactive_named = [s for s in claude if not s.get("active") and (s.get("metadata", {}).get("name") or "").strip()]
print(f"\nOK={ok} ZOMBIE={zombie}  (plus {len(inactive_named)} inactive named sessions in list)")
PY
