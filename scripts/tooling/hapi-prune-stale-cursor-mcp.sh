#!/usr/bin/env bash
# Prune stale HAPI Cursor MCP sidecar entries from project + user mcp.json.
#
# Canon: docs/tooling/cursor-hapi-mcp.md
#   - Never rewrite --url to the hub
#   - Project hapi / hapi-* entries are legacy debt (pre user-level overlay)
#   - User-level (~/.cursor or realpath) keeps live PID-stamped overlays
#
# Usage:
#   hapi-prune-stale-cursor-mcp [--dry-run] [--root DIR]...
#   hapi-prune-stale-cursor-mcp --strip-project-hapi   # also drop live project hapi keys
set -euo pipefail

DRY_RUN=0
STRIP_PROJECT_HAPI=0
ROOTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --strip-project-hapi) STRIP_PROJECT_HAPI=1; shift ;;
    --root) ROOTS+=("$2"); shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ${#ROOTS[@]} -eq 0 ]]; then
  ROOTS+=("${HOME}/coding")
fi

USER_CURSOR="${HAPI_CURSOR_MCP_CONFIG_DIR:-}"
if [[ -z "$USER_CURSOR" ]]; then
  if [[ -L "${HOME}/.cursor" ]]; then
    USER_CURSOR="$(readlink -f "${HOME}/.cursor" 2>/dev/null || true)"
  elif [[ -d "${HOME}/.cursor" ]]; then
    USER_CURSOR="${HOME}/.cursor"
  fi
fi

python3 - "$DRY_RUN" "$STRIP_PROJECT_HAPI" "${USER_CURSOR:-}" "${ROOTS[@]}" <<'PY'
import json, os, socket, sys, urllib.request
from pathlib import Path

dry_run = sys.argv[1] == "1"
strip_project = sys.argv[2] == "1"
user_cursor = Path(sys.argv[3]) if sys.argv[3] else None
roots = [Path(p) for p in sys.argv[4:]]

def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

def port_open(url: str) -> bool:
    # http://127.0.0.1:PORT/...
    try:
        from urllib.parse import urlparse
        u = urlparse(url)
        if u.hostname not in ("127.0.0.1", "localhost", "::1"):
            return False
        port = u.port
        if not port:
            return False
        with socket.create_connection((u.hostname, port), timeout=0.35):
            return True
    except OSError:
        return False

def extract_url(entry: dict) -> str | None:
    args = entry.get("args") or []
    if not isinstance(args, list):
        return None
    for i, a in enumerate(args):
        if a == "--url" and i + 1 < len(args):
            return str(args[i + 1])
    return None

def is_hapi_key(key: str) -> bool:
    return key == "hapi" or key.startswith("hapi-")

def decide_drop(key: str, entry: dict, *, project: bool) -> tuple[bool, str]:
    if not is_hapi_key(key):
        return False, "keep-non-hapi"
    if project and strip_project:
        return True, "strip-project-hapi"
    if project and not strip_project:
        # Legacy project overlays: drop if port dead OR (PID stamped and dead).
        pid_raw = (entry.get("env") or {}).get("HAPI_MCP_OVERLAY_PID")
        url = extract_url(entry) or ""
        if pid_raw:
            try:
                pid = int(str(pid_raw))
            except ValueError:
                pid = 0
            if pid and pid_alive(pid) and port_open(url):
                return False, "keep-live-project"
            return True, "dead-project"
        if url and port_open(url):
            return False, "keep-open-port-project"
        return True, "stale-project-no-pid"
    # User-level: only drop PID-stamped dead overlays; leave bare `hapi` alone.
    if key == "hapi":
        url = extract_url(entry) or ""
        if url and not port_open(url):
            return True, "stale-legacy-hapi-user"
        return False, "keep-legacy-hapi-user"
    pid_raw = (entry.get("env") or {}).get("HAPI_MCP_OVERLAY_PID")
    if not pid_raw:
        url = extract_url(entry) or ""
        if url and not port_open(url):
            return True, "stale-user-no-pid"
        return False, "keep-user-no-pid"
    try:
        pid = int(str(pid_raw))
    except ValueError:
        return True, "bad-pid"
    if not pid_alive(pid):
        return True, "dead-pid"
    return False, "keep-live-user"

def prune_file(path: Path, *, project: bool) -> None:
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        print(f"SKIP {path}: {e}")
        return
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or not servers:
        return
    drop = []
    for key, entry in list(servers.items()):
        if not isinstance(entry, dict):
            continue
        should, reason = decide_drop(key, entry, project=project)
        if should:
            drop.append((key, reason, extract_url(entry)))
    if not drop:
        return
    print(f"{'DRY ' if dry_run else ''}{path}:")
    for key, reason, url in drop:
        print(f"  - {key} ({reason}) url={url}")
        if not dry_run:
            del servers[key]
    if dry_run:
        return
    if not servers:
        # Leave empty mcpServers object rather than delete file (other tools may expect it).
        data["mcpServers"] = {}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

seen: set[Path] = set()
if user_cursor:
    user_mcp = user_cursor / "mcp.json"
    if user_mcp.is_file():
        prune_file(user_mcp, project=False)
        seen.add(user_mcp.resolve())

import subprocess

def iter_project_mcp(root: Path):
    # Cap depth: ~/coding/<repo>/.cursor/mcp.json and one nested worktree level.
    # Avoid walking node_modules / giant trees (rglob on ~/coding is minutes).
    cmd = [
        "find", str(root),
        "-maxdepth", "5",
        "(", "-path", "*/node_modules/*", "-o", "-path", "*/.git/*", ")", "-prune",
        "-o", "-path", "*/.cursor/mcp.json", "-type", "f", "-print",
    ]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return
    for line in out.splitlines():
        line = line.strip()
        if line:
            yield Path(line)

for root in roots:
    if not root.is_dir():
        print(f"SKIP root missing: {root}")
        continue
    for path in iter_project_mcp(root):
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        project = True
        if user_cursor and resolved == (user_cursor / "mcp.json").resolve():
            project = False
        prune_file(path, project=project)
        seen.add(resolved)
PY
