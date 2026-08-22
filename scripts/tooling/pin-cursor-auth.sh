#!/usr/bin/env bash
# pin-cursor-auth.sh — ExecStartPre for hapi-runner*.service
# Keep auth.json + systemd env files aligned with ~/.hapi/cursor.env (source of truth).
# See docs/tooling/cursor-auth-fleet-sync.md
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
[[ -f "$HOME/.hapi/cursor.env" ]] || exit 0
set -a
# shellcheck disable=SC1091
source "$HOME/.hapi/cursor.env"
set +a
[[ -n "${CURSOR_API_KEY:-}" ]] || exit 0

# Unlock if a prior sync left the file immutable — agents need r/w for token refresh.
sudo chattr -i "$HOME/.config/cursor/auth.json" 2>/dev/null || true

python3 - <<'PY'
import json
import pathlib

home = pathlib.Path.home()
env_key = (
    home.joinpath(".hapi/cursor.env")
    .read_text()
    .split("=", 1)[1]
    .strip()
)
if not env_key.startswith("crsr_"):
    raise SystemExit(0)

def write_env(path: pathlib.Path, key: str) -> None:
    if path.name == "api-key.env":
        body = (
            "# Derived from ~/.hapi/cursor.env — pin-cursor-auth.sh. Do not hand-edit.\n"
            f"CURSOR_API_KEY={key}\n"
        )
    else:
        body = f"CURSOR_API_KEY={key}\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() == body:
        return
    path.write_text(body)
    path.chmod(0o600)

# Keep systemd + oos runner drop-ins in lockstep with cursor.env.
for rel in (
    ".config/cursor/api-key.env",
    ".config/hapi-oos-agent.env",
):
    write_env(home / rel, env_key)

auth_path = home / ".config/cursor/auth.json"
cur: dict = {}
if auth_path.exists():
    try:
        cur = json.loads(auth_path.read_text())
    except Exception:
        cur = {}

if cur.get("apiKey") == env_key:
    raise SystemExit(0)

out: dict = {"apiKey": env_key}
for k in ("accessToken", "refreshToken"):
    if isinstance(cur.get(k), str) and cur[k]:
        out[k] = cur[k]
auth_path.parent.mkdir(parents=True, exist_ok=True)
auth_path.write_text(json.dumps(out) + "\n")
auth_path.chmod(0o600)
PY
# Intentionally leave writable — chattr +i breaks agent -p / ACP session/new (EPERM → Internal error).
