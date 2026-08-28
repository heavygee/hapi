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

Intentional exception: uncommitted `config/driver-manifest.yaml` layer WIP during soup promotion — **the mess-maker must still commit before turn end** (see below). Do not pile unrelated mirror dirt on top.

### Mess-maker tooling commits (not the next agent)

Operator utensils on the mirror (`docs/tooling|operator|plans`, `scripts/tooling`, `config/driver-manifest.yaml`, `.cursor/rules`) are **your** kitchen — nothing upstream forces porcelain. Leaving them uncommitted remake-blocks sync/rebuild for everyone.

**Policy:** the session that dirties those paths commits them in the **same turn**. The next agent who only needs `hapi-sync-fork-main` / `hapi-driver-rebuild` must **not** inherit cleanup.

**Mechanical:** `scripts/tooling/hapi-tooling-commit-guard.sh` (per-session ledger under `~/.hapi/tooling-dirt/`). Cursor: `stop` follow-up + Shell gate on sync/rebuild; Claude: Stop + PostToolUse via `hapi-claude-pretooluse-guard.sh` / settings. Rule: `.cursor/rules/hapi-tooling-commit-hygiene.mdc`. Refresh: `hapi-install-cursor-hooks.sh`. Bypass (operator TTY only): `HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE=1`.

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

**Manifest:** **Repo** `config/driver-manifest.yaml` is the recipe (tracked, commit on fork `main`). Rebuild reads it via `hapi-manifest-path.sh`. `~/.config/hapi/driver-manifest.yaml` is a **generated mirror** (`scripts/tooling/hapi-manifest-mirror-to-config.sh`). Legacy override: `HAPI_DRIVER_MANIFEST` env only.

**Composed soup tree:** `~/coding/hapi/driver` on branch `driver/integration` — output of rebuild, not a substitute for the manifest when adding layers.

```yaml
base: upstream/main
layers:
  - branch: feat/pluggable-voice-backend
  - pr: 692
  - branch: origin/feat/session-list-attention
```

Layers merge **in order** onto `driver/integration` inside `~/coding/hapi/driver`.

### Trial-merge before you add a layer

The soup is shared by the whole fleet, so a layer that conflicts costs everyone a broken rebuild. `git merge-tree` answers "would this merge cleanly?" without writing anything:

```bash
git merge-tree --write-tree --messages "$(git -C driver rev-parse HEAD)" <your-branch>
# exit 0 = clean; exit 1 = prints each CONFLICT (content) path
```

Run it before editing `config/driver-manifest.yaml`. If it conflicts, do **not** add the layer and hope rerere saves you — rerere only replays resolutions it has already seen, and a brand-new branch has none. The owning peer writes a `scripts/tooling/soup-heals/*.patch` and/or a `driver/<feature>` union tip that merges clean, then promotes. **Do not** leave the feature out of soup "because peer stack worked" — `:3006` is where we dogfood, and the soup should carry every in-flight tip.

Upstream-aimed thin tips stay based on `upstream/main` for the PR. Soup may need a separate `driver/<feature>` union when the thin tip conflicts with other layers — that is expected, not a reason to skip soup.

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

**Operator scripts** (`scripts/tooling/hapi-meta-daily.sh`, `hapi-pr-emoji-batch.sh`, stub `hapi-pr-session-emoji.sh`, etc.) belong on **fork `main` in `~/coding/hapi`**, not in the driver tree. Rebuild reads tooling from the primary mirror (`HAPI_PRIMARY`, default `~/coding/hapi`). Uncommitted scripts vanish on sync/reset — **commit them to fork main**. Daily PR classify + chip status: `hapi-meta-daily.sh` (see `docs/operator/AGENTS.md` § Meta PR watcher).

**To put a PR worktree on `:3006` instead of soup:** operator runs `hapi-use-worktree ~/coding/hapi/worktrees/<name>` (not the usual daily-driver path).

### Rebuild (patient hub+runner restart when hub/cli/shared change)

```bash
hapi-driver-rebuild --build-web --verify
```

By default, a **successful** promote that touches `hub/`, `cli/`, or `shared/` chains into **patient `hapi-restart-hub`** (hub + runner) — same drain contract as a manual restart. Web-only remats skip restart (hard-reload dogfood). Opt out: `HAPI_DRIVER_NO_RESTART=1`.

Does **not** swing `hapi-active` (that is `--activate` / `hapi-use-worktree`).

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
5. **Dogfood smoke (mandatory after web remat; now mechanical):** `hapi-driver-rebuild --build-web` and `hapi-driver-build-web` run **`hapi-session-open-smoke` then `hapi-session-send-smoke`** after verify and **auto-rollback** `web/dist` (+ live tip on full remat) on fail. Manual equivalent: `curl -sf http://127.0.0.1:3006/health` **and** both smokes. List-page health + `verify-soup-web-dist` alone are **not** enough — incident 2026-08-04 wave absorb (`2191ceced`) was verify-green while every session route error-boundaried. Mount-only open-smoke is also **not** enough — 2026-08-08 tip-forward shipped `restoredIntent` ReferenceError (composer Enter no-op) while open-smoke stayed green. Skip both with `HAPI_SKIP_SESSION_OPEN_SMOKE=1` (operator emergency). Skip send-only with `HAPI_SKIP_SESSION_SEND_SMOKE=1` (not recommended — that is how the operator gets cut off).
   - **Do not hand-`git reset` live `driver/integration` to unfinished remat WIP** to "try" a tip — that is what poisoned dogfood at 2026-08-04 13:40 (`d0e948d6f` → session-open-smoke FAIL → tip rollback to `04a1d31a9`). Finish layers/heals on `driver-remat`, then promote via `hapi-driver-rebuild` so smoke can refuse a bad tip.
6. Garden / VR check when those layers matter
7. Log drift in `~/coding/hapi-garden/GARDEN_LOGBOOK.md` if API changed

Do **not** leave merged feature branches as live soup layers — they bitrot against `upstream/main` and break rebuild when the remote tip is deleted.

### Absorbing a merged community schema PR (tip-forward)

When upstream lands a schema-touching PR that soup already dogfooded (or remumbered past):

1. **Drop** the soup layer (peer Gate A) — do not leave a stale union tip on the manifest.
2. **Tip-forward remat:** prefer **upstream product surfaces** (API/UI/column names); keep soup-only schema owners that already advanced `SCHEMA_VERSION` (e.g. jobs at v23 while upstream pin is v22).
3. **Column ensure, not version bump alone:** live DBs whose `user_version` already passed the step that *should* have added columns will skip that migration. Run idempotent `PRAGMA table_info` + `ALTER TABLE … ADD COLUMN` in `finishSchemaInit` (or equivalent boot heal) for every new column the absorb needs. SQLite has no `ADD COLUMN IF NOT EXISTS` — check first. Example: `#1115` `global_pinned` via `ensureSessionPinColumns` after soup was already at v23 with `pinned` only.

Exit reflection source: [`2026-08-08-pinned-sessions-soup-exit.md`](../plans/retros/2026-08-08-pinned-sessions-soup-exit.md).

### Keeping fork `main` truthful

Fork `main` = **`upstream/main` + fork-only docs/plans**. After upstream merges: run `hapi-sync-fork-main`. Meta bot: weekly `--check-only` even if idle.

---

## Excision registry — dropping a layer does not remove the code

**A dropped manifest layer does NOT remove code that other layers happen to re-carry.**

Soup layers are cut from an integration tip, so a branch inherits whatever was in the tree when it
was created — including code that has nothing to do with its own feature. Drop the layer that
"owns" some code and it can still arrive via any number of unrelated fat layers, on every rebuild,
silently.

**The instance this came from (2026-08-17 → 2026-08-27):** `feat/a2a-p05-peer-provenance` was
dropped to excise the rejected #1473 capability stack. Seven other active layers — kitchen-status,
operator-dock, doctor-provenance, fleet-runner-upgrade, overseer-brain-active,
cursor-notify-rule-delta, invalid-argument-bridge-gate — each carried
`hub/src/web/peerCapability.ts` inside their own diffs. The drop was correct and achieved nothing.
Operator canon said soft-nametag while the running hub enforced a session-id-bound HMAC for ten more
days; it only surfaced when attributed peer messaging began failing 403 for sessions whose id had
rotated (ids rotate often — see `sync/sessionCache.ts` merge-and-replace).

**The guard:** record the excision in [`config/soup-excised.yaml`](../../config/soup-excised.yaml).
`scripts/tooling/hapi-soup-excised-check.mjs` runs from `hapi-driver-rebuild --verify` and fails the
rebuild if any **active** manifest layer still carries an excised path or symbol, naming the layers.

```bash
# what the rebuild runs
bun run scripts/tooling/hapi-soup-excised-check.mjs
# ad-hoc, without touching the registry
bun run scripts/tooling/hapi-soup-excised-check.mjs --path hub/src/web/peerCapability.ts
bun run scripts/tooling/hapi-soup-excised-check.mjs --symbol verifyPeerSessionCapability
bun run scripts/tooling/hapi-soup-excised-check.mjs --json
```

Commented-out manifest lines are treated as inactive (that is the "already dropped" case), so a
layer you have commented out will not be reported. Use `allow:` on a registry entry for the
branch that legitimately reintroduces something — e.g. the replacement implementation.

**When you excise something, add it to the registry in the same change.** Otherwise the next fat
layer quietly puts it back and nobody finds out until behaviour contradicts the docs.

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
| `hapi-driver-build-web` | Web/dist only on current driver tree (no re-merge); runs session-open-smoke + dist rollback on fail |
| `hapi-session-open-smoke` | Playwright gate: `/sessions/:id` must not Show Error / #185 / missing composer |
| `hapi-session-send-smoke` | Playwright gate: type + Send/Enter must not `ReferenceError` (message POSTs aborted — no agent yank) |
| `hapi-verify-web-dist` | Audit: driver `web/src` strings present in live `web/dist` |
| `hapi-driver-rollback-web` | Promote `web/dist.prev` back to live |
| `hapi-worktree-create` | New PR worktree (+ merge train) |
| `hapi-use-worktree <path> [--impatient]` | **Patient by default** — drain WORKING sessions, swing `hapi-active`, prep DB, restart hub + runner |
| `hapi-use-driver` | **Operator:** swing `hapi-active` to driver + restart (verify stamp) |
| `hapi-restart-hub [--impatient] [--no-runner]` | **Agent OK:** patient restart hub (+ runner) on current stack — no symlink move |
| `hapi-driver-db-prep <target>` | Backup DB + auto-downgrade schema to match `<target>`'s SCHEMA_VERSION; called automatically by `hapi-use-worktree` |
| `hapi-driver-status [--json\|--quiet\|--watch]` | Read coordination state — is a rebuild/switch in flight, when did the last one finish, how many WORKING sessions right now |
| `hapi-runner-from-active` | systemd helper — runner CLI from `hapi-active/cli` (**soup / rebuild-only**; ignores Upgrade binaries) |
| `hapi-from-active` → `~/.local/bin/hapi` | Interactive soup CLI on PATH (`hapi ping-peer`, etc.). Beats stale `~/.bun/bin/hapi` npm global. Install: `install-hapi-local-bin.sh`. **Inside a HAPI checkout**, cwd `node_modules/.bin` often still wins — invoke this path **absolutely** for `spawn-peer` / `job` / `ping-peer`. |
| `hapi-cli-path-hygiene` | Removes bun/npm global `@twsxtd/hapi` shadows that lack `job`/`ping-peer` (Peer #7 2026-08-09). Also **warns** when `command -v hapi` is `node_modules/.bin` (Arthur scout 2026-08-28). `--check` / `--clean`. Run on soup hosts after bootstrap. |
| `hapi-spawn-peer` | Peer spawn + remit. Supports `--model` / `--effort`. Prefer over bare `hapi spawn-peer` when PATH may be npm-shimmed. |
| `hapi-ping-peer` | Peer nudge / handoff. Prefers soup `hapi ping-peer`; bash fallback if soup CLI missing. **Not** ad-hoc `bun run src/index.ts` |
| `hapi-sessions-health.sh` | Session monitor |

### Soup hosts vs fleet Upgrade

**Ops call (2026-07-22, meta):** soup-entrypoint hosts are **rebuild-only**. Do **not** expect hub UI Upgrade to move their advertised CLI version.

| Host type | How version moves | Upgrade button |
|-----------|-------------------|----------------|
| Binary runners (Windows, stock Linux `~/.hapi/bin/hapi`) | Hub artifact / self-upgrade | Works (after PE `.exe` chicken-egg is past) |
| Soup hosts (`ExecStart=…/hapi-runner-from-active`) | `hapi-driver-rebuild` onto new `upstream/main`, then `hapi-restart-hub` | **No-op** for skew — systemd keeps the soup entrypoint |

**Why not "prefer `~/.hapi/bin/hapi` when newer" (option A):** that silently swaps soup → vanilla binary and drops every manifest layer. Kill criterion: operator thinks they're dogfooding soup, machine is on stock.

**Why not soup-promotion-on-Upgrade (option C):** third entrypoint story; remote boxes lack the soup tree; fights `hapi-active`.

**Estate defaults for soup runners (primary hub host only — e.g. oos-linux):**
- `hapi-runner-from-active` exports `HAPI_DISABLE_VERSION_HANDOFF=1` by default (override only if you know why).
- Rematerialize when hub `targetVersion` advances; do not click Upgrade on the **soup hub host** to "catch up."
- Ordinary fleet machines (homelab/proxmox, Windows laptops, etc.) are **runners only** — they must **not** set `HAPI_DISABLE_VERSION_HANDOFF`. Fleet Upgrade / auto policy is the path.
- Per-machine product opt-outs remain available: `HAPI_UPGRADE_CHANNEL=off`, `versionHandoffDisabled` (soup host).

**Temporary binary bridge (historical secondary / demoted-hub pattern — anti-primary):** when a **demoted** host's local `driver/cli` is too stale to advertise required caps, a systemd drop-in (`30-soup-artifact.conf`) may point `ExecStart` at `~/.hapi/bin/hapi-<semver>` instead of `hapi-runner-from-active`. That keeps `versionHandoffDisabled: true` (intentional on a demoted soup unit) while advertising a tip binary. **It is not soup parity** with the primary (no manifest layers). **Never install this on the primary soup host** — see § Anti-primary / footgun. Keep the drop-in version current with hub `targetVersion`; remove it once that host is either rematerialized soup or converted to a normal fleet runner (`HAPI_DISABLE_VERSION_HANDOFF=0`, stock `~/.hapi/bin/hapi`). Homelab/proxmox post-cutover is a normal fleet runner — do not re-apply soup handoff-disable there. Incident 2026-07-23: drop-in stuck on `hapi-soup` **0.23.1** while oos ran soup **0.23.3** - Pi RPC wedged; bumping the drop-in to `hapi-0.23.3` + hub `restart-runner` restored tool traffic.

**Windows chicken-egg (ops playbook):** old self-upgrade wrote `hapi-VERSION` without `.exe`. Promote once: `copy hapi-VERSION → hapi-VERSION.exe → hapi.exe`, then `schtasks /Run /TN "HAPI Runner"`. Or SCP `/var/lib/hapi/upgrade-artifacts/hapi-*-win32-x64` → `%USERPROFILE%\.hapi\bin\hapi.exe`. Future Upgrades from a fixed binary should self-heal.

Sources: `scripts/tooling/` in repo; installed to `~/.local/bin/`.

### Coordination (avoid stack-switch contention)

With ~30 agents on this repo, two callers can land on `hapi-driver-rebuild` or `hapi-use-worktree` simultaneously — one rewrites the driver tree mid-merge while the other reads it, or two stack switches race on the symlink and hub restart.

Both scripts now take a single `flock` on `~/.hapi/locks/stack.lock` (shared with `hapi-restart-hub`) and publish state to `~/.hapi/driver-status.json` (atomic rewrite, schema v1). A second concurrent rebuild **or** switch **or** hub restart exits **75** (`EX_TEMPFAIL`) with a pointer at the first.

**Why one lock?** Separate rebuild/switch locks allowed a rebuild to rewrite `~/coding/hapi/driver` while another agent ran `hapi-restart-hub` or `hapi-use-driver` — the collision that bit triage + overseer on 2026-06-20.

**Before kicking off a rebuild or switch** (especially from a peer agent), run:

```bash
hapi-driver-status            # human summary
hapi-driver-status --quiet    # exit 0 idle, 75 busy, 76 remat-hold, 2 stale-pid
```

`--quiet` is the right thing for an agent precheck:

```bash
if ! hapi-driver-status --quiet; then
    echo "driver stack busy, remat-hold, or stale -- inspect with hapi-driver-status"
    exit 1
fi
hapi-driver-rebuild --build-web --verify
# Or wait up to 10 min for the stack to clear:
# HAPI_DRIVER_WAIT_BUSY_SECS=600 hapi-driver-rebuild --build-web --verify
```

**Soup rebuild owner (policy):** one agent/session owns manifest + rebuild at a time (`hapi-driver-status` flock). When the tip is ready for `:3006` dogfood, the **feature peer** edits **repo** `config/driver-manifest.yaml` (commit on mirror same turn), mirrors to `~/.config` via `hapi-manifest-mirror-to-config.sh` if needed, and runs `hapi-driver-rebuild --build-web --verify` — do not ping operator/orchestrator to add the layer, and do not wait for a separate "approve soup" gate. Meta session (`8c6b5a7d`) is for **manifest-only** cron rebuilds, stack hygiene, and **remat escalation**. Do not run rebuilds in parallel hoping flock saves you.

### Remat escalation hold (2026-07-30)

Happy-path remat is CLI-only and mostly deterministic (`hapi-driver-rebuild --build-web --verify`). When remat **fails** (layer merge conflict, **soup-heal apply conflict / router-dedupe heal error**, or post-promote verify/typecheck/test rollback), the stack is nondeterministic enough that **parallel “helpers” thrash the tip**. Fail closed:

1. **Auto-set hold** on remat failure → `~/.hapi/remat-hold.json`
2. **Block** `hapi-driver-rebuild`, `hapi-driver-build-web`, and `driver_remat_promote` for everyone except the escalate owner (exit **76**)
3. **Cursor hook** `hapi-remat-hold-guard.sh` denies Shell remat/build-web while hold is active
4. **Owner only** clears or continues remat

| Who | What to do |
|---|---|
| Feature peer / other agent | Stop. `hapi-remat-hold status`. Ping Meta (`hapi-ping-peer 8c6b5a7d`). Do **not** retry remat or hand-promote. |
| Meta remat owner (`config/remat-escalate.yaml`) | Token + identity (below). Success auto-clears hold. |
| Operator (TTY) | `HAPI_OPERATOR_REMAT_HOLD_CLEAR=1 hapi-remat-hold clear` |

**Owner proof (all three):**

```bash
# once per machine (Meta / operator):
hapi-remat-hold init-owner

export HAPI_REMAT_OWNER=1
export HAPI_REMAT_OWNER_TOKEN="$(cat ~/.config/hapi/remat-owner.token)"
export HAPI_AGENT_LABEL=meta-soup   # or session id matching owner_session_prefix
hapi-driver-rebuild --build-web --verify
```

```bash
hapi-remat-hold status          # human + exit 76 if held
hapi-remat-hold check           # exit 0 / 76
hapi-driver-status              # shows remat-hold block
```

Config: `config/remat-escalate.yaml`. Token: `~/.config/hapi/remat-owner.token` (not git). Label alone is not enough. Same-UID agents can still `cat` the token file — abuse is a kill-criterion. Enforcement: script exit 76 + Cursor/Claude PreToolUse hooks.

### Atomic remat — failed rebuild must not move the live tip (2026-07-30)

`hapi-driver-rebuild` rematerializes on **`driver/integration-wip`** in **`~/coding/hapi/worktrees/driver-remat`**, then promotes `driver/integration` only after layers (+ heals) succeed. **`web/dist` already had `dist.prev` rollback; the git tip now matches that contract.** On failure the escalation hold is set (see above) so peers cannot pile on.

**Default mode (2026-08-05): tip-forward.** WIP starts at the last green soup tip (`PREV_TIP`), merges `upstream/main` only if needed, **skips** layers already ancestors of the tip, and runs a **fat-tip gate** before absorbing non-ancestors (refuse >20 non-merge commits or >40 files vs merge-base unless `HAPI_REMAT_ABSORB_FAT=1`). Soup-heals that fail to apply are **warn-skipped** in tip-forward (they are mostly no-ops on a green tip); full-recipe still fail-closes.

Escape hatch for disaster / recipe audit: `HAPI_REMAT_MODE=full-recipe` (old behavior: hard-reset WIP to manifest `base` / `upstream/main` and replay every layer). Probe: `docs/plans/2026-08-05-remat-tip-forward-probe.md`, `scripts/tooling/probe-remat-tip-forward.sh`.

| Failure | Live `driver/integration` | Where to look |
|---|---|---|
| Merge conflict mid-stack | **Unchanged** (pre-remat SHA) | Remat worktree stays conflicted — resolve there, or `git merge --abort` |
| Fat layer tip skipped (tip-forward gate) | Remat continues (layer **not** absorbed) | **Ping the layer owner.** They re-thin 1–3 commits onto the **current soup tip** (not stack more onto fat `driver/<feature>`). Meta override `HAPI_REMAT_ABSORB_FAT=1` only if wedged. SKIP ≠ dogfood of that layer. |
| Soup-heal apply conflict (`apply -3` base drift) / router-dedupe heal error | **Unchanged** (pre-remat SHA) | Tip-forward: warn-skip. Full-recipe: remat WT left for owner (`heal_fail`) |
| Post-promote typecheck / tests / dist verify | **Restored** to pre-remat SHA | Re-run after fixing the gate |

Incident 2026-07-29 19:11Z: in-place `checkout -B driver/integration upstream/main` + layer loop `exit 1` left tip stuck after `feat/cursor-picker-ios-nested` — PR awareness + rich-composer vanished from source while stale dist still looked rich. That class must not recur.

Override remat worktree: `HAPI_DRIVER_REMAT_WT=/path`.

### Fat SKIP is not a thin layer (2026-08-15, #1424)

Incident: `driver/session-attached-jobs` stayed fat; tip-forward SKIP WARN (57c/90f). Rescue was a **new thin** `driver/session-jobs-delta`. Operator intuition "rebase keeps soup thin" is false when the layer ref is not **re-tipped** onto live soup HEAD after each dogfood bump.

**Must:**

1. Remat SKIP WARN → **ping the layer owner** (`hapi-ping-peer`). Do not call the wave green for that feature.
2. Owner: cherry-pick / re-thin **1–3 commits onto current soup tip**, force-push the layer branch, update the manifest comment (`thin-tip SHA` + `re-thin after dogfood bump`). Do **not** grow fat `driver/<feature>`.
3. Dogfood close: `hapi-driver-status` HEAD == the SHA in the manifest comment. MCP subprocesses may need **session resume** after hub restart (lifecycle soup promotion).
4. Gate A when the upstream PR merges: drop **fat parent and rescue delta** together.

Manifest lint (refuse layer if commit-count vs tip > fat-gate threshold) is **not** shipped — fat-tip gate already skips at remat. Lint would catch the miss earlier; file a tooling issue if SKIP WARN keeps getting ignored. Do not `HAPI_REMAT_ABSORB_FAT=1` to hide a fat layer.

### Manifest drop is not absorb (2026-08-18, heavygee#133)

Incident: `/overseer` Set active → hub `PUT /api/overseer/brain/active` 404. Web panel + `GET …/models` survived; the write handler did not.

Sweep `1d4644037` ("sync manifest drops", claimed merged #897) copied stale `~/.config/hapi/driver-manifest.yaml` onto repo `config/driver-manifest.yaml` and **deleted** `feat/overseer-admin-console` + relay-ping + converse-context. Those fork PRs (#103 / #104 / #106) were **still OPEN**. Next remat omitted the merges. Heals `a786d6a8e` / `3d47e56b3` restored web + `SettingsStore` for typecheck, not the PUT.

**Must:**

1. Recipe is **repo** `config/driver-manifest.yaml`. Do not "align repo to ~/.config" in a way that deletes `- branch:` lines. Refresh runtime copy with `scripts/tooling/hapi-manifest-mirror-to-config.sh` (repo → ~/.config only).
2. Pre-commit runs `hapi-manifest-drop-gate.sh staged` — refuses removing a layer whose `heavygee/hapi` PR is OPEN unless operator names the branch (`HAPI_MANIFEST_DROP_OPEN_PR=1` + TTY).
3. A soup heal that restores a web client for a hub route the module no longer defines is incomplete. Handler needles (`REQUIRED_HANDLERS_IN_MODULE` in `hapi-soup-route-mounts-check.mjs`) — mount-only is not enough.
4. `GET` models 200 + `PUT` active 404 is split-brain, not "the LLM is down."

Full writeup: [`2026-08-18-overseer-brain-active-soup-drop-postmortem.md`](../plans/2026-08-18-overseer-brain-active-soup-drop-postmortem.md).

### externalRefs wipe — mid-stack hub + sparse metadata (2026-07-30)

**Where they went:** nowhere recoverable — SQLite `sessions.metadata` was overwritten. The three active peer sessions lost `metadata.externalRefs` (PR chips). Overseer `link_seen` events still mentioned the PRs; that is not the chip source.

**Why:**

1. Failed remat (19:11Z) left live tip at `0c93f5d57` (after `cursor-picker-ios-nested`) — **before** `driver/github-pr-awareness`. That tip’s `mergeSessionMetadata` had `ALERT_STATE_FIELDS` but **no** `CONTRIBUTION_FIELDS` / `externalRefs` carry-forward.
2. Hub was restarted onto that tip (**20:07** and again **00:50**) and kept that **in-memory** code.
3. Remat later restored/promoted a good tip (**01:51→02:29**, `0a497f569`) on disk, but the hub process was **not** restarted until **08:51** — still serving the mid-stack merge.
4. Active CLIs kept sending `update-metadata` (summaries, lifecycle, etc.) **without** `externalRefs`. On the mid-stack hub those writes **replaced** the JSON blob → PR links deleted. (`updated_at` can stay stale when a later re-link uses `touchUpdatedAt: false`.)

**Already fixed / must not regress:**

| Guard | Role |
|---|---|
| Atomic remat | Live tip never stays mid-stack on merge failure |
| `CONTRIBUTION_FIELDS = ['externalRefs']` | Sparse omit preserves links once awareness is on the tip |
| `verify-externalrefs-preserve.mjs` (via hotfiles check) | Tip with `externalRefs` in schemas **must** carry-forward; CLI `[]` guard present when strip gate exists |
| Rebuild hub-skew warning | Tip has `features.ts` but `/api/features` not alive → print `hapi-restart-hub` |
| Socket omit-empty `[]` | CLI `update-metadata` with `externalRefs: []` must not unlink (PUT `/external-refs` remains the clear path) |

**Operator rule after any remat that touches `hub/`:** patient `hapi-restart-hub` before calling dogfood green (features + preserve code must match the tip). Hard-reload alone is not enough.

### NEVER park a peer layer to unblock rematerialize (2026-07-28)

Commenting out someone else's `- branch:` so `hapi-driver-rebuild` goes green **skunks the soup** — dogfood loses chips / attachments / bridges until someone remembers. Incident: meta parked `driver/github-pr-awareness` (and others) for upstream #896 remake → PR chips vanished on `:3006` again.

| Who | Must |
|---|---|
| **Feature peer** (layer owner) | Keep tip **thin**: prefer `upstream/main` + your delta, or the **exact remat pre-layer SHA** Meta names after a failed remat. **Do not** thin onto `origin/driver/integration` (stale publish tip). Tip-forward remat starts from the live soup tip and **refuses fat moved tips** (>20 non-merge commits / >40 files) — re-thin onto current tip before asking Meta to remat. After each dogfood bump, **re-tip the layer** (1–3 commits on current soup HEAD); rebasing a fat `driver/<feature>` history does not make tip-forward absorb it. Manifest comment: thin-tip SHA + `re-thin after dogfood bump`. When rematerialize fails on *your* layer: re-thin / force-push / fix conflicts yourself, then un-park if you parked. Rescue thin layers (`driver/<feature>-delta`) drop **with** the fat parent at Gate A. |
| **Meta / rematerialize agent** | **Do not** park peer layers to get a green rebuild. Fail closed: leave the layer active, ping the owning peer (`hapi-ping-peer`), report blocked. Allowed only if the operator **names the exact branch** to park. After a web-facing remat (esp. driver-side conflict unions): **smoke `/sessions` in a real browser** (or Playwright) before calling dogfood green — `bun test` + `verify-web-dist` alone missed `getTodoProgress is not defined` (2026-07-29). If the UI was broken, force a **new `index-*.js` content hash** and tell operators to hard-reload / clear Workbox if sticky. |
| **Operator** | Explicit park instruction per branch — never "just make rematerialize green." |

Parking your **own** layer briefly while you re-thin is fine. Parking a peer's layer is not.

### SessionList hot-conflict — unbound helpers (2026-07-29, twice)

`SessionList.tsx` is a soup hot file. Remat / feature merges onto the soup tip have **twice** deleted local helpers (`getTodoProgress`, icons, attention imports) while leaving call sites — dogfood dies with a full-page `getTodoProgress is not defined` error boundary.

| Incident | Cause |
|---|---|
| Morning | rich-composer + awareness SessionList union |
| Afternoon | `feat/session-header-machine-meta` (#1241) merge onto soup tip |

**Rules:**

1. **Do not** “resolve” SessionList conflicts by deleting helper defs. Prefer `web/src/lib/sessionRowHelpers.ts` (shared `getTodoProgress` / `getSessionTimeLabel`) so a SessionList-only merge cannot remove the only binding.
2. **Rebuild fails closed:** `verify-sessionlist-bindings.mjs` runs from `hapi-driver-build-web`, `verify-soup-web-dist`, and `hapi-soup-hotfiles-check` — unbound `getTodoProgress(` / `getAttentionLabel(` / `getSessionTimeLabel(` → rebuild exits non-zero before dogfood eats it.
3. Soup-heal `scripts/tooling/soup-heals/62-sessionlist-row-helpers.patch` re-applies the shared module + imports if a layer drops them again.
4. After any SessionList soup merge: smoke `/sessions` past the error boundary (not only unit tests).

### HappyComposer send-intent / SessionChat terminal — tip-forward heal-required (2026-08-08)

Tip-forward absorb of upstream into soup WIP repeatedly left **call sites without declarations** in hot chat files. Session-open smoke only checks mount (no error boundary + composer textbox present) — it does **not** exercise Enter/send.

| Incident | Broken identifier | Symptom |
|---|---|---|
| Same-day tip-forward `#1407` union | `canViewAgentTerminal` in `SessionChat.tsx` | Every session route error-boundary |
| Tip-forward absorb `64a116f47` | `restoredIntent` / `resetPendingSendIntent` in `HappyComposer.tsx` | Composer Enter/send no-op; `ReferenceError` in dist (`index-CtoMYV9e.js`). Fix: `de78a3650` |

**Rules:**

1. **Heal-required unions:** any tip-forward / layer merge that touches `HappyComposer.tsx` send path (`pendingSendIntentRef`, `restoredIntent`, `flushAndSend`) or `SessionChat.tsx` terminal overlay (`canViewAgentTerminal`, `DragDropZone` nesting) must keep **both** the consume site and the declaration. Prefer taking the fuller upstream send-intent block over a partial HEAD stub.
2. **Rebuild fails closed:** `verify-happycomposer-bindings.mjs` runs from `hapi-driver-build-web`, `verify-soup-web-dist`, and `hapi-soup-hotfiles-check` — unbound `restoredIntent` / `resetPendingSendIntent` / `canViewAgentTerminal` → rebuild exits non-zero before dogfood ships.
3. Soup-heal `scripts/tooling/soup-heals/101-happycomposer-restored-intent.patch` re-applies the send-intent declaration block if a later absorb drops it again.
4. **Send smoke (mandatory):** `hapi-session-send-smoke` runs after open-smoke in the build gate — types a probe string, clicks Send and presses Enter, fails on `ReferenceError` / unbound identifiers / Show Error. Message POSTs are aborted so live agents are not yanked. Source binding check (`verify-happycomposer-bindings.mjs`) is the fast pre-build kill-criterion; send smoke is the dogfood kill-criterion.

### Re-thin bases (2026-07-29 — awareness remat)

Remat does **not** merge onto `origin/driver/integration`. It builds on **`driver/integration-wip`** in the remat worktree from `upstream/main` + layers, then promotes the live tip only on success. A tip that `merge-tree`s clean vs yesterday’s published `driver/integration` can still explode (100+ files) against today’s intermediate.

| Thin onto | When |
|---|---|
| `upstream/main` + feature-only delta | Default for soup/feature layers |
| Exact SHA Meta pastes after a failed remat (e.g. `Merge … cursor-picker-ios-nested` tip just before your layer) | One-shot recovery — that SHA is **run-local**; next remat may mint a different hash with the same subject line |
| `origin/driver/integration` | **Never** as the re-thin base (incident: Peer `b30cf5c0` / `driver/github-pr-awareness`) |

### Remat conflicts on `playwright.config.ts` — do not push fork tooling onto product tips (2026-07-28)

Soup layers often carry fork peer-stack Playwright config (`HAPI_PEER_WEB_URL`, annotated-video, …). Upstream-bound product tips must stay simple (at most `testIgnore: ['**/peer/**']`). See [`peer-stack.md` § Upstream PR worktree](./peer-stack.md#upstream-pr-worktree--fork-tooling-read-this) and § Meta remat.

| Remat conflict on | Meta must |
|---|---|
| `playwright.config.ts` | Keep **soup/fork** peer-stack file in driver; take only tip deltas that are product-relevant (`testIgnore`). Leave tip alone — **no** “absorb the playwright.config union” ping when the union includes `scripts/dev/*` fork imports. |
| Product source (`web/` / `hub/` / …) | Still ask the owning peer to fix the **branch tip** (thin / rebase). |

Incident: Meta asked Peer #1215 to absorb a rerere union → tip shipped annotated-video onto an upstreamable branch; reverted. Dogfood does not require product tips to own soup Playwright config.

**Stale state** (process died without releasing): `hapi-driver-status` prints `STALE pid=N (dead)` and the exact `rm` to clear the lock. The status file self-heals on the next successful run.

### Stale soup merge-tips (FCM / PushNotificationChannel)

Some manifest layers are **integration merge-tips** (`soup/cursor-model-error-fcm-bridge`, old `fix/soup-codex-sse-metadata-collision`, etc.) — branches created by merging two features once, then left to rot while lower layers evolve.

**Symptom (historical, pre-#803):** every `hapi-driver-rebuild` fought `hub/src/push/pushNotificationChannel.test.ts` — a fat FCM merge-tip still carried the deleted **`NativeFallbackProbe` 5th constructor arg** while lower FCM (`feat/companion-fcm-push-api`, now upstream #803) had the modern **per-dispatch `NotificationSendContext`** API (`8f870516`).

**Rule:** a soup layer must be either a **single-feature branch** rebased onto upstream/main, or a **thin delta** (one cherry-pick) on top of the base it depends on — never a fat merge of an older copy of files a lower layer (or upstream) already owns. Post-#803, `soup/cursor-model-error-fcm-bridge` is **sendModelError-only on `upstream/main`** (imports `modelErrorCopy` from later detect/`#878` layers).

**FCM bridge refresh (when push tests conflict again):**

```bash
cd ~/coding/hapi/worktrees/cursor-model-error-fcm-bridge
git fetch upstream main
git reset --hard upstream/main   # post-#803 FCM already on main
git cherry-pick d1c4294a3        # sendModelError only (or e2d5a294c / historically 64583aa7)
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

### Soup-critical route mounts (server.ts remount loss)

**Class:** tip-forward absorb / heal warn-skip drops soup-only `app.route(...)` mounts from `hub/src/web/server.ts` while the route module file remains. Observed casualties: `/api/features` (heal 99), system-events/inbox/overseer (heal 100 restore), `/cli/upgrade/cli-artifact` (heal 100 remount-upgrade — 2026-08-07 fleet toasts served SPA `index.html` as the binary).

**Gate:** `hapi-driver-rebuild` always runs `hapi-soup-route-mounts-check.mjs` on the remat WIP **after heals, before promote**. If the route module exists, `server.ts` must call the matching `create*Routes(` factory. Fail closed + remat hold (same as heal_fail). Also chained from `hapi-soup-hotfiles-check` under `--verify`.

**When you add a soup-only HTTP surface:** append a row to `REQUIRED_IF_MODULE_PRESENT` in that script and land a numbered `soup-heals/*.patch` remount. Do not rely on heals alone under tip-forward warn-skip.

**Guest migration (oos-linux):** oos-linux is now the **canonical soup host**. Promote layers by editing manifest on the guest, then `hapi-driver-rebuild --build-web --verify` **on oos-linux** — do not `sync-oos-hapi-driver.sh` homelab→guest after a guest-only rebuild (overwrites composed soup). Homelab manifest is legacy reference only.

**Bypass** (testing only): `HAPI_SKIP_DRIVER_LOCK=1`. Skips both flock and status writes; collisions corrupt the driver tree.

**Why no hub API route?** The hub may be down *during* a switch — exactly when status is most wanted. File-backed status is readable when the hub is dead.

### Patient restarts (don't yank live agents)

`hapi-use-worktree` and `hapi-restart-hub` are **patient by default**: they poll `hapi-sessions-health.sh` for `WORKING` sessions and wait until effective WORKING reaches 0 before tearing the hub down. **Default is no auto-timeout** (`HAPI_PATIENT_TIMEOUT=0`). A positive timeout **fails closed** (exit 75, no restart/switch) — it does **not** yank. Only `--impatient` (TTY-gated) proceeds with WORKING>0.

#### Watching a restart blocks the restart

The drain self-exempts **only the caller** (one subtracted from the WORKING count). Any *other* session polling in a loop — a meta watcher tailing `driver-status.json`, a peer checking whether the hub pid flipped — stays `WORKING` for as long as its turn runs, and the patient drain waits on it. Two agents watching each other can hold a restart open indefinitely while both report "still blocked".

If you are not the one running `hapi-restart-hub`:

- **Park.** End your turn and wait to be pinged. Do not open a turn just to check state.
- If you must observe, take one snapshot and end the turn — no `sleep`/poll loops.
- Before escalating "the restart is stuck", read the WORKING list (`scripts/hapi-sessions-health.sh --json`) and check whether you are on it.

Observed 2026-07-25: soup rebuild went green at `10:10:30Z` but the hub stayed 17h old because the meta watcher was polling for the pid flip and counted toward the drain it was waiting on.

### Hub restart must not cascade-archive the fleet (KillMode)

**What you saw** ("every session archived after hub reboot") is not destiny and not a missing restore bridge. It is systemd killing the runner **cgroup**.

- Runner already spawns agents with `detached: true` and does **not** kill children on its own shutdown (`cli/src/runner/run.ts`).
- `detached: true` escapes the TTY / session — **not** the systemd cgroup.
- Default `KillMode=control-group` → `systemctl restart hapi-runner` SIGTERMs every agent in the unit → each agent archives itself (`User terminated`). Patient drain only waits for WORKING; **idle** sessions still die.
- Upstream closed this as [tiann/hapi#915](https://github.com/tiann/hapi/issues/915) via docs `KillMode=process` (PR #928). Proxmox already had it; **oos-linux still had `KillMode=control-group` until 2026-07-24**.

### Tier-1 primary-hub package (reinstall / new hub host)

Proxmox accumulated months of hardening; oos cutover missed most of it. **Do not copy the whole proxmox stack** - cutover/artifact drop-ins are anti-primary. Install the Tier-1 package instead:

```bash
sudo bash scripts/tooling/install-hapi-primary-hub-tier1.sh
# then (or --restart):
hapi-restart-hub
```

| Piece | Effect |
|-------|--------|
| `10-resilience.conf` | `Restart=always`, burst limits, `KillMode=process`, `HAPI_DISABLE_VERSION_HANDOFF=1`, `ExecStartPre=runner stop` |
| `90-oom-protect-hub.conf` | hub `OOMScoreAdjust=-1000` (earlyoom must not murder hub) |
| `90-oom-protect-runner.conf` | runner explicit `0` (never -1000 - agents inherit) |
| `hapi-runner-watchdog.{service,timer}` | 60s probe; restarts runner unit if machine drops off hub |
| `hapi-watchdog` sudoers + protect/wrapper | NOPASSWD runner restart; hub stop/restart still blocked |

Sources: `scripts/tooling/systemd/`, `scripts/tooling/sudoers/`. Unit names auto-detect (`hapi-*-oos` vs `hapi-*`).

#### Anti-primary / footgun — do NOT port these to the active hub

**Naming trap:** `cutover-oos*` means "oos is primary; **this host is demoted**." It is not a hardening package the primary is missing. After cutover drift, agents often re-pitch "copy everything proxmox has onto oos." That is wrong for the items below — they are **anti-primary by design**. Re-pitching them = failing the next review.

| Proxmox-only item | Why it must stay off primary (oos) |
|---|---|
| `hapi-hub.service.d/cutover-oos.conf` (+ `cutover-oos-hub-only.conf`) | `ConditionPathExists=!/etc/hapi/homelab-hub-forbidden` + `Restart=no`. Purpose: refuse to run a **second** hub on the old host. On primary that is "please stay down if a sentinel appears" + disable crash restart — opposite of Tier-1 `Restart=always`. |
| `/etc/hapi/homelab-hub-forbidden` | Empty sentinel that **blocks hub activation**. Correct on secondary; on primary it is a landmine (one accidental `touch` = no hub). |
| Runner `cutover-oos.conf` (`HAPI_API_URL=https://hapi-gc-oos.forest-adder.ts.net`) | Points a **secondary** runner at the remote primary. Oos already uses `http://127.0.0.1:3006`. Copying the remote URL onto the hub host is self-talk over Tailscale for no reason. |
| `30-soup-artifact.conf` (`ExecStart=~/.hapi/bin/hapi-<semver>`) | Temporary **stock binary** bridge when secondary `driver/cli` is stale. **Not soup** (no manifest layers). Primary *is* the soup kitchen — this drop-in would drop every layer and recreate the 2026-07-23 version-skew / Pi RPC class of bug on the wrong host. Remove on secondary once `hapi-runner-from-active` + rematerialized soup is current. |

**Falsification (before you "just port it"):**

1. If cutover belonged on primary, starting `hapi-hub` on proxmox after deleting the sentinel would be fine. It is not — two hubs = split brain. The conf exists to make that **impossible**.
2. If artifact belonged on primary, oos dogfood would deliberately run stock `~/.hapi/bin/hapi-*` instead of soup. It must not.

**Not a Tier-1 gap either (already elsewhere):**

- **Hub DB backups** — live oos DB is protected from **homelab** via `protect-oos-hapi-state.sh` (4x daily sqlite archive + ZFS snap). Proxmox `backup-hapi.timer` is Tier C (runner/secrets borg) post-migration — do not install that unit on oos as if the hub DB still lived under `~/.hapi`.
- **earlyoom + jellyfin prefer lists** — host/estate memory policy, optional on oos separately; hub already has `OOMScoreAdjust=-1000`. Not cutover baggage.
- **Primary-shaped follow-ups** (OK to discuss): `ExecStart` → `hapi-runner-from-active`; plain earlyoom on oos without media prefer lists.

Canonical inventory + install path: [`coding-estate-migration.md`](./coding-estate-migration.md) § New primary hub host.

**Kill-criterion after install + restart:** archived session count unchanged; live runner env has `HAPI_DISABLE_VERSION_HANDOFF=1`; hub `/proc/$pid/oom_score_adj` is `-1000`; `systemctl is-enabled hapi-runner-watchdog.timer`.

**Local KillMode-only fix (superseded by Tier-1):** drop-in at `hapi-runner-oos.service.d/killmode-process.conf` - redundant once `10-resilience` is present.

**What survives after the fix:**

| Bounce | Expectation |
|--------|-------------|
| `hapi-restart-hub --no-runner` | Hub only. Runner + agents stay up; socket.io reconnects. Prefer this when only hub code changed. |
| `hapi-restart-hub` (hub+runner) with `KillMode=process` | Runner PID dies; **agents stay**; new runner re-attaches (Tier B: `feat/tier-b-reattach-orphan-runner-children` in soup). |
| `KillMode=control-group` (old oos) | Entire fleet archives. Bad. |

**Not the primary fix:** a "reopen everything after restart" sweep. That papers over cgroup murder, doubles spawn cost, and races mid-turn. Keep reopen for true crashes / intentional archives (`POST /sessions/:id/reopen`). If you still want a recovery script for past cascade incidents, say so - cheap to add, but it is recovery, not architecture.

**Friction / kill-criterion for claiming "restarts are safe":** after next intentional `hapi-restart-hub`, count of `lifecycleState=archived` must be unchanged (modulo deliberate archives). If the fleet archives again, KillMode did not stick or something else is in the cgroup path - stop and fix before more soup waves.

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
# Recipe: edit config/driver-manifest.yaml in the fork (commit on main).
# Optional runtime mirror for tools that still read ~/.config:
scripts/tooling/hapi-manifest-mirror-to-config.sh

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
