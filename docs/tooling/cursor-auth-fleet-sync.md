# Cursor auth fleet sync (oos ↔ proxmox runners)

**Fork-local ops.** Keep Cursor Agent credentials coherent across the estate so a host kill / account switch does not leave runners on a different key than `auth.json`, or on a half-commented `api-key.env` museum.

Related (different problem): [`cursor-hapi-mcp.md`](./cursor-hapi-mcp.md) — MCP sidecar URLs, not login.

## Topology (2026-08)

| Host | Role | How Cursor creds reach the runner |
|------|------|-----------------------------------|
| **oos-linux** | Hub `:3006` + local runner | `hapi-runner-oos.service` → `EnvironmentFile=-~/.hapi/cursor.env` + `~/.config/hapi-oos-agent.env` + `ExecStartPre=~/.hapi/pin-cursor-auth.sh` |
| **proxmox** (homelab) | Fleet runner only | `hapi-runner.service.d/20-cursor-api-key.conf` → `~/.config/cursor/api-key.env`; optional `25-pin-cursor-auth.conf` → same pin script |

Hub JWT / CLI token is unrelated. This doc is only **Cursor Agent** login (`agent` / ACP).

## Source of truth

**Canonical blob:** `~/.config/cursor/auth.json` on **oos-linux** after a good `agent login` (or equivalent).

Must contain:

- `apiKey` (`crsr_…`)
- `accessToken`
- `refreshToken`

Everything else is **derived** from `apiKey`:

| File | Purpose |
|------|---------|
| `~/.config/cursor/api-key.env` | systemd `EnvironmentFile` → `CURSOR_API_KEY=…` (proxmox drop-in; also fine on oos) |
| `~/.hapi/cursor.env` | Same single line; what `pin-cursor-auth.sh` compares against |
| `~/.config/hapi-oos-agent.env` | oos runner also loads this; `CURSOR_API_KEY` there must match `auth.json` |

**Do not** keep alternate accounts as commented `#CURSOR_API_KEY=` lines in the live env file. That is how runners silently lose the key (all-comment file → empty env → ACP `Authentication required`) or flip accounts under pressure. Archive history under `~/.config/cursor/auth-bak/` if needed.

## Why pin (and when *not* to leave auth immutable)

`agent` / ACP can **rewrite** `auth.json` on refresh to a different account’s tokens. Incident class (2026-08-09): oos auth copied to proxmox, then a live agent rewrite flipped `apiKey` back to a usage-limited lockhouse key while `api-key.env` still pointed at the oos key (or the reverse). Sessions then fail with `Authentication required` / `Upgrade your plan to continue` even though `agent -p` “works” under `CURSOR_API_KEY`.

Mitigations:

1. **`scripts/tooling/pin-cursor-auth.sh`** (also installed as `~/.hapi/pin-cursor-auth.sh`) — on runner start: keep `auth.json`, `api-key.env`, and `hapi-oos-agent.env` aligned with `cursor.env` (preserve oauth tokens in `auth.json` when possible).
2. **Do not leave `chattr +i` on `auth.json` during normal ops.** Cursor opens the file read/write for token refresh. Immutable → `EPERM` → ACP `session/new` / `session/load` fail with opaque **`Internal error`**, and `agent -p` dies. Use `+i` only for a short window while copying/syncing if you must, then **`chattr -i` before any agent/runner work**.

Pin may temporarily unlock; it must not leave the file immutable afterward if agents need to run.

## Sync procedure (oos → fleet runner)

Run from **oos-linux** (LAN to proxmox: `192.168.86.73` / `proxmox.lan`). Do not print key material.

```bash
# 1) Copy canonical auth (exact bytes)
scp ~/.config/cursor/auth.json heavygee@192.168.86.73:/tmp/auth.json.oos

# 2) On proxmox: install auth + derive envs + lock + restart runner
ssh -tt heavygee@192.168.86.73 'bash -s' <<'EOF'
set -euo pipefail
sudo chattr -i "$HOME/.config/cursor/auth.json" 2>/dev/null || true
cp -f /tmp/auth.json.oos "$HOME/.config/cursor/auth.json"
chmod 600 "$HOME/.config/cursor/auth.json"

python3 - <<'PY'
import json, hashlib
from pathlib import Path
auth = json.loads(Path.home().joinpath(".config/cursor/auth.json").read_text())
key = auth["apiKey"]
assert key.startswith("crsr_") and len(key) == 69
assert {"accessToken", "refreshToken", "apiKey"} <= set(auth)
Path.home().joinpath(".config/cursor/api-key.env").write_text(
    "# Derived from ~/.config/cursor/auth.json — synced from oos-linux. Do not hand-edit.\n"
    f"CURSOR_API_KEY={key}\n"
)
Path.home().joinpath(".config/cursor/api-key.env").chmod(0o600)
Path.home().joinpath(".hapi/cursor.env").write_text(f"CURSOR_API_KEY={key}\n")
Path.home().joinpath(".hapi/cursor.env").chmod(0o600)
print("apiKey_sha12", hashlib.sha256(key.encode()).hexdigest()[:12])
PY

# pin script should exist (copy from oos ~/.hapi/pin-cursor-auth.sh if missing)
# drop-in optional but recommended:
#   /etc/systemd/system/hapi-runner.service.d/25-pin-cursor-auth.conf
#   [Service]
#   ExecStartPre=/home/heavygee/.hapi/pin-cursor-auth.sh

# Leave auth.json writable (Cursor token refresh). Do NOT chattr +i for steady-state.
# Runner restart needs a real TTY for the systemctl wrapper override:
HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 sudo -E systemctl restart hapi-runner.service
sleep 2
systemctl is-active hapi-runner.service
lsattr "$HOME/.config/cursor/auth.json"   # should NOT show immutable 'i'
# runner must see the key:
python3 - <<'PY'
import hashlib
from pathlib import Path
import subprocess
pid = int(subprocess.check_output(
    ["systemctl", "show", "hapi-runner.service", "-p", "MainPID", "--value"], text=True
))
env = dict(x.split(b"=", 1) for x in open(f"/proc/{pid}/environ", "rb").read().split(b"\0") if b"=" in x)
k = env.get(b"CURSOR_API_KEY", b"").decode()
auth = json.loads(Path.home().joinpath(".config/cursor/auth.json").read_text())
import json
print("runner_key_match_auth", k == auth["apiKey"], "sha12", hashlib.sha256(k.encode()).hexdigest()[:12] if k else None)
PY
EOF
```

**Never** `sudo systemctl restart hapi-hub` for this. Runner-only.

Hub `POST /api/machines/:id/restart-runner` may return `restart_unavailable` on fleet supervisors — use the TTY + `HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1` path above.

## Verify (no secrets)

```bash
# Fleet-wide (sha12 table; exit 1 on drift, 2 if a host is unreachable):
~/coding/hapi/scripts/tooling/hapi-cursor-auth-audit.sh
~/coding/hapi/scripts/tooling/hapi-cursor-auth-audit.sh --quiet   # only problem rows

# Single host:
~/coding/hapi/scripts/tooling/hapi-cursor-auth-audit.sh --local-only
```

Canonical for drift is **`~/.hapi/cursor.env`** (what `pin-cursor-auth.sh` enforces). Live `agent` ACP processes can rewrite `auth.json` to a stale refresh token between runner restarts — that is expected noise if `cursor.env`, `api-key.env`, and the runner still MATCH.

Per-host manual check:
python3 - <<'PY'
import json, hashlib
from pathlib import Path
d = json.loads(Path.home().joinpath(".config/cursor/auth.json").read_text())
print(sorted(d.keys()), hashlib.sha256(d["apiKey"].encode()).hexdigest()[:12])
PY

# Smoke (uses CURSOR_API_KEY + auth.json):
export PATH="$HOME/.local/bin:$PATH"
set -a; source ~/.config/cursor/api-key.env; set +a
agent status   # account label
timeout 40 agent -p --model auto --output-format text 'reply with exactly: pong'
```

If `agent -p` works but HAPI Cursor ACP still says `Authentication required`, check the **session process** inherited `CURSOR_API_KEY` (runner restart after env rewrite) and that `auth.json` was not rewritten (`lsattr` should show `i`).

## Revive a killed Cursor ACP session (after auth is good)

Hub `POST /api/sessions/:id/reopen` can return `resume_failed` / crash-loop on ACP auth blips. Prefer binding the original row on the **runner host**:

```bash
# On proxmox — packaged binary (driver bun source may lack tokenInit on thin trees)
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.hapi/bin:$PATH"
export HAPI_API_URL='http://192.168.86.79:3006'   # oos hub LAN
export HAPI_SETTINGS="$HOME/.hapi/settings.json"
set -a; source ~/.config/cursor/api-key.env; set +a

# hapi-safe-revive-session needs bun + driver/cli; if that 404s modules, use:
hapi cursor \
  --resume <cursorSessionId> \
  --hapi-starting-mode remote \
  --started-by runner \
  --existing-session-id <hapiSessionId> \
  --permission-mode yolo
```

Revive **one at a time** on memory-tight proxmox (earlyoom). See also `hapi-safe-revive-session` header comments.

## Switching Cursor account (operator)

1. On oos: log in / set the new account; confirm `auth.json` has the new `apiKey` + tokens.
2. Update oos derived files (`cursor.env`, `hapi-oos-agent.env` `CURSOR_API_KEY`) to that `apiKey` only.
3. Run **Sync procedure** to each fleet runner.
4. Restart runners; spot-check `agent -p` and one HAPI Cursor reopen.
5. Do not leave the previous key commented in live env files.

## Anti-patterns

| Don’t | Why |
|-------|-----|
| Comment out every `CURSOR_API_KEY` in `api-key.env` | Runner loads empty → ACP auth failures |
| Hand-edit proxmox toward a different `crsr_` than oos “to try the other account” | Splits fleet; usage-limit / plan errors look like “auth broken” |
| Rely on `agent status` “Logged in as …” alone | Can disagree with `CURSOR_API_KEY` / `auth.json.apiKey` |
| Restart hub to pick up Cursor env | Wrong unit; yanks sessions |
| `set -x` while sourcing env files | Leaks keys into agent logs |

## Incident notes

- **2026-08-09:** Hard kill of proxmox runner + commented-out `api-key.env` + account thrash. Fix = restore oos `auth.json`, derive single-line envs, runner restart, revive with `hapi cursor --resume … --existing-session-id …`. Leaving `chattr +i` on `auth.json` later caused ACP `Internal error` / “shell broken”; unlock for steady-state. Poisoned ACP stores: quarantine `~/.cursor/acp-sessions/<id>` and fresh-bind the same HAPI row (no `--resume`).
