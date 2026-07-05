#!/usr/bin/env bash
# Merge HAPI PR review Cursor user hooks into ~/.cursor/hooks.json (non-destructive).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_SRC="${REPO_ROOT}/scripts/tooling/hooks/cursor"
USER_HOOKS_DIR="${HOME}/.cursor/hooks"
USER_HOOKS_JSON="${HOME}/.cursor/hooks.json"

mkdir -p "$USER_HOOKS_DIR"
for f in pr-before-shell-gates.sh pr-post-push-check.sh pr-pre-create-gate.sh; do
  [[ -f "$HOOKS_SRC/$f" ]] || { echo "missing $HOOKS_SRC/$f" >&2; exit 1; }
  ln -sf "$HOOKS_SRC/$f" "$USER_HOOKS_DIR/$f"
  chmod +x "$HOOKS_SRC/$f"
done

python3 - "$USER_HOOKS_JSON" <<'PY'
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
data = {"version": 1, "hooks": {}}
if path.is_file():
    data = json.loads(path.read_text())

hooks = data.setdefault("hooks", {})

def ensure_list(key):
    if key not in hooks or not isinstance(hooks[key], list):
        hooks[key] = []
    return hooks[key]

before = ensure_list("beforeShellExecution")
if not any("./hooks/pr-before-shell-gates.sh" in (e.get("command") or "") for e in before):
    before.append({"command": "./hooks/pr-before-shell-gates.sh"})

post = ensure_list("postToolUse")
if not any("./hooks/pr-post-push-check.sh" in (e.get("command") or "") for e in post):
    post.append({
        "command": "./hooks/pr-post-push-check.sh",
        "matcher": "Shell",
        "timeout": 360,
    })

path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2) + "\n")
print(f"install-hapi-cursor-user-hooks: merged → {path}")
PY

echo "install-hapi-cursor-user-hooks: OK"
