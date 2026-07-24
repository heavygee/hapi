# Daily Driver + Merge-Train Worktrees

> **Workflow (mermaid, done criteria, agent permissions):** [`feature-work-lifecycle.md`](./feature-work-lifecycle.md) **only.** This file is manifest mechanics, DB jiu-jitsu, locks, and atomic swap — not a second copy of the flow.

> **New host?** Run [`install-hapi-operator-lock.sh`](../../scripts/tooling/install-hapi-operator-lock.sh) once (see [`operator-lock.md`](./operator-lock.md)). On oos-linux, lockhouse [`bootstrap-oos-linux-hapi-guards.sh`](../../../../lockhouse-janus/scripts/bootstrap-oos-linux-hapi-guards.sh) runs **`git pull`** on the guest mirror + rsyncs gitignored config, then installs guards.

**Moving work between hosts:** [`coding-estate-migration.md`](./coding-estate-migration.md).

Three git layers on this machine:

```
~/coding/hapi              primary mirror (fork main + tooling docs)
~/coding/hapi/driver       driver/integration — daily soup tree on :3006
~/coding/hapi/worktrees/<name>   one worktree per feature / upstream PR
~/coding/hapi/worktrees/garden-route   XR Garden source (manifest layer)
```

Legacy paths (`~/coding/hapi-driver`, `~/coding/hapi-<name>`) may still exist — **new work** uses `~/coding/hapi/worktrees/<name>` only.

`hapi-active` → the **active HAPI tree**. Hub + runner systemd units run from this path (`hub/` + `cli/`).

### Mirror utensil hygiene

The primary mirror must stay **remake-ready**: `hapi-sync-fork-main` and `hapi-driver-rebuild` refuse a dirty working tree. Any agent that leaves uncommitted `package.json` / lockfiles / `e2e/` WIP on the mirror skunks the kitchen for everyone.

| Never on `~/coding/hapi` (mirror) | Do this instead |
|---|---|
| `bun install` / `npm install` / `bun add` | `cd worktrees/<feature> && bun install` |
| Write feature / peer `e2e/**` on mirror | Write under `worktrees/<feature>/e2e/` |

**Mechanical guard:** `scripts/tooling/hapi-mirror-hygiene-guard.sh` (Cursor + Claude PreToolUse). Refresh hooks: `scripts/tooling/hapi-install-cursor-hooks.sh`. Bypass (operator TTY only): `HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1`.

Intentional exception: uncommitted `config/driver-manifest.yaml` layer WIP during soup promotion — coordinate and commit promptly; do not pile unrelated mirror dirt on top.

---

## Primary dev host (oos-linux)

Since Phase P, **soup foundry + production dogfood hub** live on the **oos-linux guest**. Homelab is a **tailnet runner only** — it does not rebuild soup or own `:3006`.

| | **oos-linux (primary)** | **homelab mirror** |
|---|---|---|
| Soup rebuild | yes — `~/coding/hapi/driver` | no (runner connects to tailnet hub) |
| Dogfood URL | `http://127.0.0.1:3006` + tailnet hostname in hub env | N/A |
| Hub DB | `/var/lib/hapi/hapi.db` | N/A |
| systemd units | `hapi-hub-oos.service`, `hapi-runner-oos.service` | `hapi-runner.service` (remote hub) |
| Operator lock | `install-hapi-operator-lock.sh --with-sudo` | same if editing soup on the mirror |

**Auto-detect:** `hapi-restart-hub`, `hapi-use-worktree`, `hapi-driver-db-prep`, and `hub-port-guard` resolve unit names and DB path via `lib/hapi-systemd-units.sh`. Override with `HAPI_HUB_UNIT`, `HAPI_RUNNER_UNIT`, `HAPI_HUB_DB` / `HAPI_DB_PATH`.

**Agent rule:** follow workflow in [`feature-work-lifecycle.md`](./feature-work-lifecycle.md); run soup commands **on oos-linux** (SSH or Cursor workspace on the guest). Do not assume homelab is the soup host.

---

## Daily driver (soup)

**Manifest:** `config/driver-manifest.yaml` in the fork (tracked). Rebuild reads it via `hapi-manifest-path.sh`; legacy override: `~/.config/hapi/driver-manifest.yaml` or `HAPI_DRIVER_MANIFEST`.

**Composed soup tree:** `~/coding/hapi/driver` on branch `driver/integration` — output of rebuild, not a substitute for the manifest when adding layers.

```yaml
base: upstream/main
layers:
  - branch: feat/pluggable-voice-backend
  - pr: 692
  - branch: origin/feat/session-list-attention
```

Layers merge **in order** onto `driver/integration` inside `~/coding/hapi/driver`.

### Read-only driver tree

**`~/coding/hapi/driver` is read-only between rebuilds.** The only supported way to change it is:

```bash
# 1. Edit config/driver-manifest.yaml (add/remove layers) — commit + push before guest pull
# 2. Rebuild — resets to base + merges manifest (destroys local edits)
hapi-driver-status --quiet
hapi-driver-rebuild --build-web [--verify]
# 3. Dogfood on :3006 — follow feature-work-lifecycle.md § Soup dogfood decision tree
```

**Forbidden on `driver/`:** hand-edits, `cp` from other checkouts, local commits, raw `bun run build` in `web/` for production dogfood, **feat/worktree `web/dist` → `driver/web/dist` copy** (#921 rollback class).

### Mechanical guards (2026-06-24 — #921 + #962 incidents)

Full install path: [`operator-lock.md`](./operator-lock.md) (`install-hapi-operator-lock.sh`). Cursor **`hapi-production-mutation-guard.sh`** (installed by that script) **denies** agent shell:

**Claude (hapi repo only, not global):** `.claude/settings.json` and HAPI-spawned `--settings` inject **`hapi-claude-pretooluse-guard.sh`** as `PreToolUse` on Bash — same block list via the shared guard scripts.


- `cp`/`rsync`/`mv` from `worktrees/*/web/dist` into `driver/web/dist`
- raw `bun run build` / `vite build` under `driver/web`
- `git merge|cherry-pick|reset` on `~/coding/hapi/driver`
- `hapi-driver-rebuild` without `--build-web` (manifest merge — meta/operator only)

**Allowed:** `hapi-driver-build-web`, `hapi-driver-rebuild --build-web [--verify]`, `hapi-verify-web-dist`, `hapi-restart-hub`.

**`verify-soup-web-dist`** (runs inside `hapi-driver-build-web` by default) also fails closed on:

- missing soup marker strings **derived from `driver/web/src`** (feature routes, lazy chunks, assistant-ui modules, scratchlist lib, overseer debug UI) in dist assets / chunk filenames
- main bundle or precache regression vs `web/dist.prev`
- dist meta not from `build_web_atomic` / HEAD mismatch

If rebuild or verify fails: **STOP** — do not workaround. Report to operator.

Rule file for agents: canonical source `scripts/tooling/cursor-rules/hapi-driver-soup-dogfood.mdc`. **`hapi-install-cursor-hooks.sh` symlinks it to `~/.cursor/rules/`** (alwaysApply guidance; shell hooks are separate). Re-run installer after editing the canonical rule.

**Build stamp:** In STRICT mode (default), missing `.hapi-build-meta.json` fails verify — run `hapi-driver-build-web` to stamp dist.

**Operator scripts** (`scripts/tooling/hapi-pr-session-emoji.sh`, `hapi-pr-emoji-batch.sh`, etc.) belong on **fork `main` in `~/coding/hapi`**, not in the driver tree. Rebuild reads tooling from the primary mirror (`HAPI_PRIMARY`, default `~/coding/hapi`). Uncommitted scripts vanish on sync/reset — **commit them to fork main**.

**To put a PR worktree on `:3006` instead of soup:** operator runs `hapi-use-worktree ~/coding/hapi/worktrees/<name>` (not the usual daily-driver path).

### Rebuild (does not restart hub by default)

```bash
hapi-driver-rebuild                 # merge from manifest
hapi-driver-rebuild --build-web     # also atomic web/dist swap + verify guard
hapi-driver-rebuild --verify        # typecheck + test + promotion stamp
hapi-driver-build-web               # web/dist only — no manifest re-merge
hapi-driver-rebuild --activate      # FORBIDDEN for agents — calls hapi-use-worktree
```

**Compile pre-flight (2026-06-19):** every rebuild, stack switch, and `hapi-restart-hub` runs conflict-marker scan + hub store parse before touching live services.

### Soup dogfood

**Do not duplicate the chart here.** Follow [`feature-work-lifecycle.md` § Soup dogfood decision tree](./feature-work-lifecycle.md#soup-dogfood-decision-tree-production-3006) end-to-end.

### Atomic web swap (no 503 / blank-shell window)

`--build-web` is **agent-safe by default**. The hub serves web/dist from disk on :3006 — naive `vite build` empties dist before writing, leaving a multi-second window where any browser reload returns a blank shell and live agent sessions get nudged out-of-band.

The rebuild script instead:

1. builds into `web/dist.next/` (sibling, untouched while building)
2. sanity-checks `dist.next/index.html` exists
3. renames the current `web/dist/` → `web/dist.prev/` (atomic)
4. renames `web/dist.next/` → `web/dist/` (atomic)

The window where `web/dist/` is absent shrinks to the gap between two `rename(2)` calls — well below TCP retry granularity. Live sessions on :3006 are unaffected; nobody has to coordinate a refresh.

6. runs **`verify-soup-web-dist.mjs`** — auto-rollback to `dist.prev` on fail
7. **Memory preflight** — RAM-first gate: refuses when `MemAvailable` <2 GiB, or when swap >85% **and** `MemAvailable` <4 GiB; sticky high swap with ≥4 GiB free warns and proceeds (see [feature-work-lifecycle.md § Soup build](./feature-work-lifecycle.md#soup-build-system-vs-web))

**Web-only fix to live `:3006` while sessions are working:**

```bash
hapi-driver-build-web                 # or rebuild --build-web
hapi-verify-web-dist
# Then hard-reload — steps in feature-work-lifecycle.md
```

**Cheap rollback** if the new bundle is broken:

```bash
hapi-driver-rollback-web          # promotes web/dist.prev back to live
```

`dist.prev` only holds the **most recent** prior build (each rebuild rotates it). For deeper rollback, re-run `hapi-driver-rebuild` against an earlier manifest.

### When upstream moves

**Fleet order** (who does what): see [`feature-work-lifecycle.md` § After upstream merge](./feature-work-lifecycle.md#after-upstream-merge-fleet-cleanup--meta-sweep-must-advise-this) — notify peer → peer drops layer + cleans worktree/branch → **one** rematerialize after the wave.

Mechanical rebuild steps (after layers are dropped and fork `main` is synced):

1. **Sync fork mirror:** `hapi-sync-fork-main` then `git push origin main`
2. Edit manifest — drop layers merged to `upstream/main` (prefer the owning peer did this already; meta verifies none remain)
3. `hapi-driver-rebuild --build-web --verify`
4. `hapi-restart-hub` when hub/cli changed; hard-reload when web changed
5. Garden smoke: `curl -sf http://127.0.0.1:3006/health` + quick web/VR check
6. Log drift in `~/coding/hapi-garden/GARDEN_LOGBOOK.md` if API changed

Do **not** leave merged feature branches as live soup layers — they bitrot against `upstream/main` and break rebuild when the remote tip is deleted.

### Keeping fork `main` truthful

Fork `main` = **`upstream/main` + fork-only docs/plans**. After upstream merges: run `hapi-sync-fork-main`. Meta bot: weekly `--check-only` even if idle.

---

## PR formulation worktrees (clean upstream PRs)

**Never** file upstream PRs from `~/coding/hapi/driver`. Work in dedicated worktrees.

```bash
# Simple PR off upstream/main
hapi-worktree-create session-attention --branch feat/session-list-attention

# Merge train: your PR stacks on unmerged work
hapi-worktree-create voice-labels --branch fix/voice-flavor-labels \
  --after feat/pluggable-voice-backend

hapi-worktree-create stacked --branch feat/my-thing --after pr:692
```

Each creates `~/coding/hapi-<name>`, branch from `upstream/main` (or `--base`), optional `--after` merges.

Before every commit / `gh pr create`:

```bash
pwd
git branch --show-current
```

---

## Garden vs soup

**As of 2026-06-16:** Garden is a **first-class manifest layer** in the daily driver web app, not a separate frontend.

- **Route:** `/garden` (lazy-loaded R3F/WebXR) in the same `web/dist` the hub serves on `:3006`
- **Manifest layer:** `feat/garden-route` (source worktree: `~/coding/hapi/worktrees/garden-route`)
- **Voice/API:** same hub as flat HAPI — `VoiceBackendSession`, shared `localStorage` prefs, operator manifest voice stack
- **Retired:** standalone `garden-web.service` / `:5174` fork (`~/coding/hapi/worktrees/garden`, branch `garden/r3f-poc`) — historical only

Soup changes to hub routes/voice still affect Garden. Rebuild with `hapi-driver-rebuild --build-web`; web-only changes swap atomically. Hub/cli changes need `hapi-restart-hub` after rebuild when already on driver soup.

Pre-push hook blocks `web/src/garden/**` on upstream-PR-bound refs — Garden is fork/daily-only until a plugin system or upstream home exists.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `hapi-driver-rebuild` | Rebuild soup from manifest (`--build-web` + verify-web-dist guard) |
| `hapi-driver-build-web` | Web/dist only on current driver tree (no re-merge) |
| `hapi-verify-web-dist` | Audit: driver `web/src` strings present in live `web/dist` |
| `hapi-driver-rollback-web` | Promote `web/dist.prev` back to live |
| `hapi-worktree-create` | New PR worktree (+ merge train) |
| `hapi-use-worktree <path> [--impatient]` | **Patient by default** — drain WORKING sessions, swing `hapi-active`, prep DB, restart hub + runner |
| `hapi-use-driver` | **Operator:** swing `hapi-active` to driver + restart (verify stamp) |
| `hapi-restart-hub [--impatient] [--no-runner]` | **Agent OK:** patient restart hub (+ runner) on current stack — no symlink move |
| `hapi-driver-db-prep <target>` | Backup DB + auto-downgrade schema to match `<target>`'s SCHEMA_VERSION; called automatically by `hapi-use-worktree` |
| `hapi-driver-status [--json\|--quiet\|--watch]` | Read coordination state — is a rebuild/switch in flight, when did the last one finish, how many WORKING sessions right now |
| `hapi-runner-from-active` | systemd helper — runner CLI from `hapi-active/cli` (**soup / rebuild-only**; ignores Upgrade binaries) |
| `hapi-sessions-health.sh` | Session monitor |

### Soup hosts vs fleet Upgrade

**Ops call (2026-07-22, meta):** soup-entrypoint hosts are **rebuild-only**. Do **not** expect hub UI Upgrade to move their advertised CLI version.

| Host type | How version moves | Upgrade button |
|-----------|-------------------|----------------|
| Binary runners (Windows, stock Linux `~/.hapi/bin/hapi`) | Hub artifact / self-upgrade | Works (after PE `.exe` chicken-egg is past) |
| Soup hosts (`ExecStart=…/hapi-runner-from-active`) | `hapi-driver-rebuild` onto new `upstream/main`, then `hapi-restart-hub` | **No-op** for skew — systemd keeps the soup entrypoint |

**Why not "prefer `~/.hapi/bin/hapi` when newer" (option A):** that silently swaps soup → vanilla binary and drops every manifest layer. Kill criterion: operator thinks they're dogfooding soup, machine is on stock.

**Why not soup-promotion-on-Upgrade (option C):** third entrypoint story; remote boxes lack the soup tree; fights `hapi-active`.

**Estate defaults for soup runners:**
- `hapi-runner-from-active` exports `HAPI_DISABLE_VERSION_HANDOFF=1` by default (override only if you know why).
- Rematerialize when hub `targetVersion` advances; do not click Upgrade on proxmox/oos-linux soup units to "catch up."
- Per-machine product opt-outs remain available: `HAPI_UPGRADE_CHANNEL=off`, `versionHandoffDisabled`.

**Temporary binary bridge (proxmox pattern):** when local `driver/cli` is too stale to advertise required caps, a systemd drop-in (`30-soup-artifact.conf`) may point `ExecStart` at `~/.hapi/bin/hapi-<semver>` instead of `hapi-runner-from-active`. That keeps `versionHandoffDisabled: true` (intentional) while advertising a tip binary. **It is not soup parity** with oos (no manifest layers). Keep the drop-in version current with hub `targetVersion`; remove it once proxmox driver soup is rematerialized and `hapi-runner-from-active` is healthy again. Incident 2026-07-23: drop-in stuck on `hapi-soup` **0.23.1** while oos ran soup **0.23.3** - Pi RPC on proxmox wedged; bumping the drop-in to `hapi-0.23.3` + hub `restart-runner` restored tool traffic.

**Windows chicken-egg (ops playbook):** old self-upgrade wrote `hapi-VERSION` without `.exe`. Promote once: `copy hapi-VERSION → hapi-VERSION.exe → hapi.exe`, then `schtasks /Run /TN "HAPI Runner"`. Or SCP `/var/lib/hapi/upgrade-artifacts/hapi-*-win32-x64` → `%USERPROFILE%\.hapi\bin\hapi.exe`. Future Upgrades from a fixed binary should self-heal.

Sources: `scripts/tooling/` in repo; installed to `~/.local/bin/`.

### Coordination (avoid stack-switch contention)

With ~30 agents on this repo, two callers can land on `hapi-driver-rebuild` or `hapi-use-worktree` simultaneously — one rewrites the driver tree mid-merge while the other reads it, or two stack switches race on the symlink and hub restart.

Both scripts now take a single `flock` on `~/.hapi/locks/stack.lock` (shared with `hapi-restart-hub`) and publish state to `~/.hapi/driver-status.json` (atomic rewrite, schema v1). A second concurrent rebuild **or** switch **or** hub restart exits **75** (`EX_TEMPFAIL`) with a pointer at the first.

**Why one lock?** Separate rebuild/switch locks allowed a rebuild to rewrite `~/coding/hapi/driver` while another agent ran `hapi-restart-hub` or `hapi-use-driver` — the collision that bit triage + overseer on 2026-06-20.

**Before kicking off a rebuild or switch** (especially from a peer agent), run:

```bash
hapi-driver-status            # human summary
hapi-driver-status --quiet    # exit 0 idle, 75 busy, 2 stale-pid
```

`--quiet` is the right thing for an agent precheck:

```bash
if ! hapi-driver-status --quiet; then
    echo "driver stack busy or stale -- inspect with hapi-driver-status"
    exit 1
fi
hapi-driver-rebuild --build-web --verify
# Or wait up to 10 min for the stack to clear:
# HAPI_DRIVER_WAIT_BUSY_SECS=600 hapi-driver-rebuild --build-web --verify
```

**Soup rebuild owner (policy):** one agent/session owns manifest + rebuild at a time (`hapi-driver-status` flock). **After operator approves soup dogfood**, the **feature peer** edits `~/.config/hapi/driver-manifest.yaml` and runs `hapi-driver-rebuild --build-web --verify` — do not ping operator/orchestrator to add the layer. Meta session (`8c6b5a7d`) is for **manifest-only** cron rebuilds and stack hygiene, not routine feature promotion. Do not run rebuilds in parallel hoping flock saves you.


**Stale state** (process died without releasing): `hapi-driver-status` prints `STALE pid=N (dead)` and the exact `rm` to clear the lock. The status file self-heals on the next successful run.

### Stale soup merge-tips (FCM / PushNotificationChannel)

Some manifest layers are **integration merge-tips** (`soup/cursor-model-error-fcm-bridge`, old `fix/soup-codex-sse-metadata-collision`, etc.) — branches created by merging two features once, then left to rot while lower layers evolve.

**Symptom:** every `hapi-driver-rebuild` fights the same file (`hub/src/push/pushNotificationChannel.test.ts`) — agents re-learn that "PushNotificationChannel now takes only four constructor arguments" because layer 1 (`feat/companion-fcm-push-api`) has the modern **per-dispatch `NotificationSendContext`** API (commit `8f870516`) while a higher merge-tip still carries the deleted **`NativeFallbackProbe` 5th constructor arg**.

**Rule:** a soup layer must be either a **single-feature branch** rebased onto upstream/main, or a **thin delta** (one cherry-pick) on top of the manifest layer it depends on — never a fat merge of an older copy of files a lower layer already owns.

**FCM bridge refresh (when push tests conflict again):**

```bash
cd ~/coding/hapi/worktrees/cursor-model-error-fcm-bridge
git reset --hard feat/companion-fcm-push-api
git cherry-pick 64583aa7   # sendModelError only; resolve fcm imports if needed
```

Do **not** fix this ad hoc in `~/coding/hapi/driver` during rebuild — fix the **branch tip**, then rebuild.

### Layer collisions (shared hot files)

Some files are merged by **every** layer that touches them; **last layer wins** per hunk — there is no automatic union.

| Hot file | Typical collision |
|---|---|
| `hub/src/sync/rpcGateway.ts` | Later layer re-merges for cursor/model work; drops RPC methods an **earlier** layer added |
| `hub/src/sync/syncEngine.ts` | May keep calls via a union repair layer (`fix/soup-sync-engine-collision`) while `rpcGateway` lost the method |
| `hub/src/web/routes/machines.ts` | REST route dropped while `syncEngine` + web client still reference it |
| `web/src/components/MarkdownRenderer.tsx` | Standalone markdown cast fixes overwritten |

**Symptom:** `hapi-driver-rebuild --verify` red on homelab/guest even though feature branches typecheck clean in isolation.

**Fix pattern (2026-07-04):** add a **thin collision-repair layer** on top of the manifest — do not hand-edit `~/coding/hapi/driver`:

- `fix/soup-codex-sessions-rpc-collision` — restore `listCodexSessionsForMachine` + route
- `fix/soup-markdown-standalone-cast` — restore react-markdown component casts
- `fix/soup-sync-engine-collision` — overseer + scratchlist union on `syncEngine`

**Prevention:** `hapi-driver-rebuild --verify` runs `hapi-soup-hotfiles-check.mjs` (syncEngine calls ⊆ rpcGateway methods). When adding a layer that edits hot files, comment in the manifest which symbols must survive lower layers.

**Guest migration (oos-linux):** oos-linux is now the **canonical soup host**. Promote layers by editing manifest on the guest, then `hapi-driver-rebuild --build-web --verify` **on oos-linux** — do not `sync-oos-hapi-driver.sh` homelab→guest after a guest-only rebuild (overwrites composed soup). Homelab manifest is legacy reference only.

**Bypass** (testing only): `HAPI_SKIP_DRIVER_LOCK=1`. Skips both flock and status writes; collisions corrupt the driver tree.

**Why no hub API route?** The hub may be down *during* a switch — exactly when status is most wanted. File-backed status is readable when the hub is dead.

### Patient restarts (don't yank live agents)

`hapi-use-worktree` and `hapi-restart-hub` are **patient by default**: they poll `hapi-sessions-health.sh` for `WORKING` sessions and wait until effective WORKING reaches 0 before tearing the hub down. **Default is no auto-timeout** (`HAPI_PATIENT_TIMEOUT=0`). A positive timeout **fails closed** (exit 75, no restart/switch) — it does **not** yank. Only `--impatient` (TTY-gated) proceeds with WORKING>0.

See [`docs/plans/2026-07-20-patient-drain-v2-restart-queued.md`](../plans/2026-07-20-patient-drain-v2-restart-queued.md) for restart-queued / no-new-turns (Phase 1+) and WORKING-probe fixes.

**Never do this:**

```bash
sudo systemctl restart hapi-hub.service           # kills mid-turn agents (wrong unit on oos-linux too)
sudo systemctl restart hapi-hub-oos.service       # same — use the wrapper
```

**Always do this:**

```bash
hapi-restart-hub              # bounce hub + runner, patient
hapi-restart-hub --no-runner  # bounce hub only
hapi-use-worktree <path>      # stack switch, patient
```

**Tuning:**

| Env / flag | Default | Effect |
|-----------|---------|--------|
| `--impatient` | off | Skip drain. Restart now. Use when the hub is hung. TTY-gated for agents. |
| `HAPI_IMPATIENT=1` | off | Same, via env. For non-interactive watchdogs (needs `HAPI_IMPATIENT_BATCH=1` without TTY). |
| `HAPI_PATIENT_TIMEOUT=<sec>` | **0** (wait forever) | If >0, fail closed on expiry — **do not** restart with WORKING>0. |
| `HAPI_PATIENT_INTERVAL=<sec>` | 30 | Poll cadence. |

If WORKING never clears, the problem is sticky/false WORKING or new turns keeping the fleet busy — fix the probe or land restart-queued (plan above), do not reintroduce timeout-yank.

---

### DB schema jiu-jitsu (auto-handled, 2026-06-01)

The hub's SQLite store has **forward step-migrations only** (v1 -> v2 -> ... -> N). When the manifest changes the effective SCHEMA_VERSION, the live DB (auto: `/var/lib/hapi/hapi.db` on oos-linux, else `~/.hapi/hapi.db`) must match the target tree before hub boot:

- **Adding a schema-bumping layer (e.g. `feat/android-wear-companion` v9 -> v10):** automatic. Hub boots, `stepMigrations[N]` runs, DB ratchets forward. Nothing to do.
- **Removing one (rolling back to upstream/main; v10 -> v9):** the hub code has no down-migrations. `hapi-driver-db-prep.sh` auto-invokes from `hapi-use-worktree`, backs up the DB (timestamped `<db>.bak.pre-activate-<UTC>`), and applies known reverse SQL.

**Known reverse transitions** (extend `apply_downgrade_step()` in `scripts/tooling/hapi-driver-db-prep.sh` when a new bump lands):

| Direction | Effect | Data loss |
|-----------|--------|-----------|
| v10 -> v9 | DROP TABLE `fcm_devices` + 2 indexes (introduced by `feat/android-wear-companion`) | FCM device registrations gone from live DB; preserved in backup; Android companion re-registers on next launch |

**Bypass** (not recommended): `HAPI_SKIP_DB_PREP=1 hapi-use-worktree ...`. This restores the old behavior (raw `systemctl restart`) and you eat the hub-crash-on-schema-mismatch if you're going backward.

---

## First-time setup

```bash
mkdir -p ~/.config/hapi
cp ~/coding/hapi/docs/tooling/driver-manifest.example.yaml ~/.config/hapi/driver-manifest.yaml
# edit layers

hapi-driver-rebuild --build-web --verify
hapi-verify-web-dist
hapi-restart-hub
```

Primary mirror:

```bash
cd ~/coding/hapi && git checkout main && git merge --ff-only upstream/main
ln -sfn ~/coding/hapi ~/coding/hapi-main
```

Move an existing feature branch off primary into its own worktree before switching primary to `main`:

```bash
hapi-worktree-create pluggable-voice --branch feat/pluggable-voice-backend
cd ~/coding/hapi && git checkout main
```
