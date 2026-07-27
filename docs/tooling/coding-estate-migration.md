# Coding estate migration — move HAPI work between hosts

**Audience:** Agents working in `~/coding/hapi/**`, orchestrators moving dev between homelab, oos-linux, and fleet runners.

**Hub is always oos-linux** (`https://hapi.tail9944ee.ts.net`). Every other machine keeps a **runner** + local Cursor install. Migration moves **a subtree of `~/coding`**, its **ACP stores**, and **hub DB path/machine parenting** — not "move Cursor to the hub host."

Orchestration scripts live in **`~/coding/lockhouse-janus`** (SSH, ZFS, tailnet). This doc is the **agent entry point** inside the HAPI fork so work in HAPI folders knows where to look.

---

## What moves how

| Asset | Mechanism | Never |
|---|---|---|
| **Git repos + soup manifest** | `git push` / `git pull` on target | rsync over committed trees |
| **Operator secrets** (hub env tokens, machine-specific settings) | rsync or copy — **gitignored** | commit secrets to git |
| **Hub DB** (`/var/lib/hapi/hapi.db` on oos-linux) | `migrate-oos-hapi-state.sh`, live backup scripts | hand-copy while hub writes |
| **ACP session stores** (per runner `~/.cursor/acp-sessions`) | `backup-hapi-cursor-continuity.sh` + `repair-hapi-cursor-continuity.sh` | assume hub holds ACP |
| **Runner systemd / Windows autostart** | Tier C in `backup-hapi-estate.sh` | duplicate `machineId` across hosts |

**Rule:** If it is tracked in git → **git**. If it is local config or working memory → **rsync/tar/backup scripts**.

---

## New primary hub host (reinstall package)

When standing up another **in-scope primary hub** (or re-hardening oos after cutover drift), do **not** rsync proxmox's full systemd tree. Homelab carries **anti-primary** drop-ins (cutover / forbidden / soup-artifact) that demote the *old* hub - copying them onto the active hub is a footgun, not hardening.

**Tier-1 install (idempotent):**

```bash
sudo bash ~/coding/hapi/scripts/tooling/install-hapi-primary-hub-tier1.sh
hapi-restart-hub   # or pass --restart to the installer
```

Covers: KillMode=process, Restart=always + burst limits, `HAPI_DISABLE_VERSION_HANDOFF=1`, hub OOMScore=-1000, runner OOMScore=0, runner liveness watchdog timer, sudoers/wrapper so watchdog can restart the runner without unlocking hub stop. Details + kill-criteria: [`driver-soup.md`](./driver-soup.md) § Tier-1 primary-hub package.

### Never copy to primary (anti-primary / footgun)

**Naming trap:** `cutover-oos*` = "oos is primary; **this host is demoted**." Not "oos needs the cutover package."

| Item on proxmox | What it does | If copied to oos |
|---|---|---|
| `cutover-oos.conf` (hub) + `cutover-oos-hub-only.conf` | Gate hub on missing `/etc/hapi/homelab-hub-forbidden`; `Restart=no` | Primary refuses to start / won't crash-recover |
| `/etc/hapi/homelab-hub-forbidden` | Sentinel that **disables** hub unit | Accidental `touch` = dark hub |
| Runner `cutover-oos.conf` (`HAPI_API_URL=https://hapi…`) | Secondary runner → remote primary | Local runner hairpins over Tailscale; oos already uses `127.0.0.1:3006` |
| `30-soup-artifact.conf` | `ExecStart` stock `~/.hapi/bin/hapi-<semver>` when secondary soup is stale | Drops every soup layer on the soup kitchen; version skew breaks RPC |

**Do not re-pitch as gaps:** hub DB scheduled backup (already `protect-oos-hapi-state` 4x/day from homelab + ZFS); proxmox `backup-hapi.timer` is Tier C runner/secrets only. Full table + falsification tests: [`driver-soup.md`](./driver-soup.md) § Anti-primary / footgun.

**OK to discuss for primary (not these drop-ins):** `hapi-runner-from-active` as ExecStart; optional earlyoom on oos (hub already OOMScore=-1000).

---

## Targeted subdir move (operator pattern)

Moving e.g. `~/coding/hapi/worktrees/my-feature` from homelab → oos-linux:

1. **Commit and push** the feature branch from source host.
2. On target: `git fetch && git pull` in mirror, or `hapi-worktree-create` / `git worktree add` under `~/coding/hapi/worktrees/<name>`.
3. **Backup continuity** before path changes:
   ```bash
   cd ~/coding/lockhouse-janus
   ./scripts/backup-hapi-cursor-continuity.sh
   ```
4. **Hub session paths** — sessions store workspace paths in metadata. After a tree moves hosts, run continuity repair (rewrites paths / restores ACP to the runner recorded in `metadata.machineId`):
   ```bash
   ./scripts/repair-hapi-cursor-continuity.sh --dry-run
   ./scripts/repair-hapi-cursor-continuity.sh --apply   # operator gate
   ```
5. **Spawn/resume** on the **target runner** (same machine as the moved workspace). Hub stays on oos-linux; runner connects via tailnet.

Bulk mirror sync (legacy Phase P): `sync-oos-linux-coding-estate.sh --apply` — prefer **git pull on guest** for `hapi`/`lockhouse-janus` going forward.

---

## Lockhouse scripts (canonical)

| Task | Script |
|---|---|
| Guest git + manifest + optional soup rebuild | `bootstrap-oos-linux-hapi-tooling.sh [--rebuild]` |
| Operator lock / guards on guest | `bootstrap-oos-linux-hapi-guards.sh` (git pull + config rsync) |
| Hub DB + settings to guest | `migrate-oos-hapi-state.sh` |
| Happy-state backup (ZFS + ACP + runner config) | `backup-hapi-estate.sh` |
| ACP + hub DB continuity only | `backup-hapi-cursor-continuity.sh` |
| Restore ACP to correct runner host | `repair-hapi-cursor-continuity.sh` |
| Tailnet `svc:hapi` on guest only | `cutover-oos-hapi-tailscale.sh` |
| Migration complete gate | `verify-oos-migration-complete.sh` |

Deep docs: `lockhouse-janus/docs/phase-p-oos-dev-estate.md`, `docs/hapi-estate-backup.md`, `docs/oos-linux-network-incident.md` (guest networkd — agent runbook without guest SSH).

---

## Agent rules

- **Soup rebuild** runs on **oos-linux** only (`hapi-driver-rebuild --build-web --verify`).
- **Do not** rsync `scripts/tooling/` or `docs/tooling/` to guest — `git pull origin main` on guest after homelab push.
- **Do not** copy homelab `machineId` to guest runner settings.
- **Do not** re-enable homelab `tailscale-serve-hapi` — `svc:hapi` is **oos-linux only**.
