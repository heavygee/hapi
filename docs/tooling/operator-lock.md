# HAPI operator lock — portable fork tooling

Everything that prevents agents from breaking soup, yanking the hub, or leaking fork-private paths **lives in this repo** under `scripts/tooling/`. No homelab-only install steps.

## One-shot install

From the fork mirror (or any clone with this tree):

```bash
cd ~/coding/hapi
./scripts/tooling/install-hapi-operator-lock.sh --with-sudo
./scripts/tooling/verify-hapi-operator-lock.sh --with-sudo
```

| Flag | Effect |
|---|---|
| *(default)* | User-layer: `~/.local/bin` symlinks, git/gh wrappers, git hooks, Cursor repo + user PR hooks |
| `--with-sudo` | Also installs `/usr/local/sbin/{systemctl,tailscale}` wrappers + `/etc/sudoers.d/hapi-protect` |
| `--skip-cursor-user` | Skip merge into `~/.cursor/hooks.json` (repo preToolUse guards only) |

Fresh server checklist: clone fork → bun → `install-hapi-operator-lock.sh --with-sudo` → copy `~/.config/hapi/driver-manifest.yaml` → `hapi-driver-rebuild --build-web --verify`.

## What gets installed

| Layer | Source in fork | Target |
|---|---|---|
| CLI symlinks | `scripts/tooling/hapi-*.sh` | `~/.local/bin/hapi-*` |
| PR helpers | `lib/pr-open-push-lib.sh`, `pr-post-push-check-core.sh` | `~/.local/bin/` |
| git wrapper | `install-git-wrapper.sh` | `~/.local/bin/git` |
| gh wrapper | `install-gh-wrapper.sh` | `~/.local/bin/gh` |
| Git hooks | `install-git-hooks.sh` | `core.hooksPath` → `scripts/tooling/git-hooks/` |
| Soup guards | `hapi-install-cursor-hooks.sh` | `<repo>/.cursor/hooks.json` + soup dogfood rule |
| PR Cursor hooks | `hooks/cursor/*.sh`, `install-hapi-cursor-user-hooks.sh` | `~/.cursor/hooks/` + merge into `~/.cursor/hooks.json` |
| Claude post-push | `hooks/claude/pr-post-push-check.sh` | `~/.local/bin/pr-post-push-check` |
| systemctl guard | `sudoers/systemctl-wrapper.sh` | `/usr/local/sbin/systemctl` |
| tailscale guard | `sudoers/tailscale-wrapper.sh` | `/usr/local/sbin/tailscale` |
| sudoers signal | `sudoers/hapi-protect` | `/etc/sudoers.d/hapi-protect` |

Guest hub units (`hapi-hub-oos`, `hapi-runner-oos`) are included in systemctl/sudoers guards alongside homelab unit names.

**Stack scripts** (`hapi-restart-hub`, `hapi-use-worktree`, `hapi-driver-db-prep`, `hub-port-guard`) auto-detect guest vs homelab unit names and DB path via `lib/hapi-systemd-units.sh`.

## Deploy to oos-linux from homelab

Lockhouse orchestration (rsync tooling + remote install):

```bash
cd ~/coding/lockhouse-janus
./scripts/bootstrap-oos-linux-hapi-guards.sh
```

That script rsyncs **gitignored config only** (manifest); fork code arrives via **`git pull origin main`** on the guest.

## Related docs

- [`driver-soup.md`](./driver-soup.md) — mechanical guards rationale
- [`commit-hooks.md`](./commit-hooks.md) — git hook tiers
- [`pr-review-loop.md`](./pr-review-loop.md) — PR post-push hooks
