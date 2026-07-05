# Coding estate migration — move HAPI work between hosts

**Audience:** Agents working in `~/coding/hapi/**`, orchestrators moving dev between homelab, oos-linux, and fleet runners.

**Hub is always oos-linux** (`https://hapi.tail9944ee.ts.net`). Every other machine keeps a **runner** + local Cursor install. Migration moves **a subtree of `~/coding`**, its **ACP stores**, and **hub DB path/machine parenting** — not "move Cursor to the hub host."

Orchestration scripts live in **`~/coding/lockhouse-janus`** (SSH, ZFS, tailnet). This doc is the **agent entry point** inside the HAPI fork so work in HAPI folders knows where to look.

---

## What moves how

| Asset | Mechanism | Never |
|---|---|---|
| **Git repos** (`hapi`, worktrees, feature branches) | `git push` / `git pull` / clone on target | rsync over committed trees |
| **Operator config** (manifest, machine ids, hub env) | rsync or copy — **gitignored** | commit secrets to git |
| **Hub DB** (`/var/lib/hapi/hapi.db` on oos-linux) | `migrate-oos-hapi-state.sh`, live backup scripts | hand-copy while hub writes |
| **ACP session stores** (per runner `~/.cursor/acp-sessions`) | `backup-hapi-cursor-continuity.sh` + `repair-hapi-cursor-continuity.sh` | assume hub holds ACP |
| **Runner systemd / Windows autostart** | Tier C in `backup-hapi-estate.sh` | duplicate `machineId` across hosts |

**Rule:** If it is tracked in git → **git**. If it is local config or working memory → **rsync/tar/backup scripts**.

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

Deep docs: `lockhouse-janus/docs/phase-p-oos-dev-estate.md`, `docs/hapi-estate-backup.md`.

---

## Agent rules

- **Soup rebuild** runs on **oos-linux** only (`hapi-driver-rebuild --build-web --verify`).
- **Do not** rsync `scripts/tooling/` or `docs/tooling/` to guest — `git pull origin main` on guest after homelab push.
- **Do not** copy homelab `machineId` to guest runner settings.
- **Do not** re-enable homelab `tailscale-serve-hapi` — `svc:hapi` is **oos-linux only**.
