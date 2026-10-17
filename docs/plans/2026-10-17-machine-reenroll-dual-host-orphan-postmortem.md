# Postmortem: Oct 16 machine re-enroll → dual-host session orphans (2026-10-17 heal)

**Status:** estate mitigated (oos + proxmox remapped); product gaps still open  
**Severity:** P1 estate - Cursor/Pi resume `No machine online` across hundreds of sessions  
**Authors:** machine-registration audit session (2026-10-17)  
**Related:**

- Runbook: [`docs/tooling/machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md)
- Prior: [`2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md`](./2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md)
- Trackers: [heavygee/hapi#264](https://github.com/heavygee/hapi/issues/264) (column backfill), [#265](https://github.com/heavygee/hapi/issues/265) (persist tag), [#287](https://github.com/heavygee/hapi/issues/287) / [PR #288](https://github.com/heavygee/hapi/pull/288) (tag omit → 500/409 loop), upstream note [tiann/hapi#2038](https://github.com/tiann/hapi/issues/2038) (fork-soup fortress; not stock main)

Blameless. Systems and process gaps only.

---

## Summary

On **2026-10-16 ~11:17-11:33 UTC**, cold runner registration on the estate hit **tagged-machine conflict (`409`)**, rotated to **new machine UUIDs**, then called **`POST /cli/machines/:id/migrate-sessions` which returned `404`**. Sessions stayed on the retired machine ids. The UI looked like two oos hosts ("oos" with hundreds of sessions vs "oos-linux" with a handful) and Cursor resume failed with **`No machine online`** (`strictMachineId`).

### Why (trigger ≠ mechanism)

**Trigger:** soup tip-forward of the MachineTag registration fix ([heavygee/hapi#287](https://github.com/heavygee/hapi/issues/287) / [PR #288](https://github.com/heavygee/hapi/pull/288)) for fleet/cattle dogfood. At **11:17:55** Meta remat did a **hub+runner restart** (journal: `HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1 systemctl restart hapi-hub-oos.service hapi-runner-oos.service`, PWD `/work/coding/hapi`). That cold start is what made every runner re-register.

**Mechanism (unchanged #1473 family):** cold runner loses memory-only `runnerProof` → register conflict → CLI rotates machine UUID → `migrate-sessions` **404** → sessions stay on the ghost id. Hub bounce then forced **proxmox + Teemo** through the same path (~11:32).

**#288's job vs this outage:** #288 fixes omit-tag → silent **500** retry loop (forward tag/proof, map conflict to **409**, loud FATAL, doctor probe). It does **not** fix migrate **404**, and a cold remat restart still exercises rotate+migrate. Dogfooding the fix via soup remat is what detonated the adjacent unfixed path - ouroboros, not "fleet upgrade keepalive randomly ate the kitchen."

**2026-10-17 heal:** emergency SQL remap (runbook) moved:

| Host | Retired id | Live id | Sessions moved |
|------|------------|---------|----------------|
| oos-linux | `5f5a87e8…` (displayName `oos`) | `59986e68…` (displayName set to `oos`) | **793** (+7 already on live → **800**) |
| proxmox | `f9bb3c9e…` (displayName `homelab`) | `d1ca1b41…` (displayName `proxmox`) | **362** |

Kill-test canary: [Cove Discord Media Bot](/sessions/e6937f3e-1c3f-4784-a902-b5fa955b3a47) - was on dead proxmox `f9bb3c9e`, remapped, resume **200**, CLI live on proxmox.

---

## Operator-visible symptoms

- Session Restart / resume → **No machine online** (Cursor/Pi)
- Machines list / session grouping: **oos** (~748-793) vs **oos-linux** (~7) - same physical host, two machine rows
- Cove and other proxmox Cursor sessions similarly stuck on retired `homelab` id while a new `proxmox` runner was healthy
- Health signals (systemd runner PID, doctor local checks) could look green while registration/migrate had already failed closed

---

## Impact

| Surface | What broke | Scale |
|---------|------------|-------|
| oos Cursor/Claude/Pi resume | `metadata.machineId` → dead `5f5a87e8`, live runner `59986e68` | ~793 sessions |
| proxmox Cursor/Claude/Pi resume | `metadata.machineId` → dead `f9bb3c9e`, live runner `d1ca1b41` | 362 sessions |
| UI mental model | dual displayName/host labels for one host | operator confusion |
| Settings skew | `/var/lib/hapi/settings.json` kept old oos id; `~/.hapi` had new | doctor/tooling mismatch |
| Teemo | migrate 404 for `b5157013…`; sessions still on literal machine id `Teemo` | **31 still orphaned** (not healed 2026-10-17) |

**Not a Quest bug. Not "no machine registered at all."** Live runners were online; sessions pointed at ghosts.

---

## How fleet work, #287, and this outage interrelate

```text
Fleet / cattle goal          Machine identity must survive upgrade + VM swap
        │
        ├─ Oct 13 cattle cutover ──► #264 (column backfill), #265 (persist tag)
        │
        └─ Doug cattle host 409/500 ──► #287 / PR #288 (send tag+proof; no silent 500)
                    │
                    ▼
         Soup tip-forward #288 on oos (MachineTag register fix session)
                    │
                    ▼
         Patient hub+RUNNER restart (required to load new CLI tip)
                    │
                    ▼
         Cold re-enroll hazard (#1473 proof + migrate 404)  ◄── still open
                    │
                    ▼
         oos UUID rotate + proxmox/Teemo reconnect wave → orphaned sessions
```

| Piece | Role |
|-------|------|
| Fleet upgrade / seal / keepalive | Why durable machine id matters; morning `/api/upgrade/offer` chatter is context, **not** the 11:17 smoking gun |
| Cattle-swap (#264/#265) | Same identity problem after VM/root moves; checklist debt |
| **#287 / #288** | Real bugfix for **omit-tag registration**; dogfood remat was the **bounce that started the wave** |
| migrate-sessions 404 | Separate product hole; rotate without move = resume death for Cursor |
| This SQL heal | Estate mitigation only; next remat can re-orphan until migrate/rebind is solid |

Sessions: [MachineTag register fix](/sessions/3695d9cc-c0f0-4c5c-ad88-959dc2c98a00), [cursor - tooling/meta bot](/sessions/028d0a86-262e-4538-a735-92247d17cb5f).

---

## Timeline

Facts from `journalctl` (hub + runners), hub DB `machines.created_at`, settings `previousMachineIds`, recovery TSVs under `/var/lib/hapi/recovery/`.

| Time (local / journal) | Event |
|------------------------|--------|
| 2026-08-10 | Prior #1473 dogfood; live oos settled on `5f5a87e8` (see Aug postmortem) |
| ~2026-10-13 | Cattle cutover; #264/#265 filed (identity / tag persist) |
| **2026-10-16 ~10:14** | [#287](https://github.com/heavygee/hapi/issues/287) filed (Doug `dl-in-linux` tagged re-register); [PR #288](https://github.com/heavygee/hapi/pull/288) ~10:22 |
| **2026-10-16 11:17:55** | `systemctl restart hapi-hub-oos + hapi-runner-oos` with `HAPI_OPERATOR_SYSTEMCTL_OVERRIDE=1` (soup remat / MachineTag tip-forward) |
| **2026-10-16 11:17:57** | oos runner FATAL: re-enrolled `5f5a87e8` → `59986e68` but **session migrate failed: 404** |
| 2026-10-16 11:18+ | oos runner stays on `59986e68`; only new sessions bind there (~7 by 2026-10-17) |
| **2026-10-16 11:32:50** | Hub: proxmox `POST /cli/machines` **409** → **200** as `d1ca1b41`; **`migrate-sessions` 404** |
| **2026-10-16 11:32:55** | Hub: Teemo path same pattern → `b5157013`; **`migrate-sessions` 404** |
| 2026-10-16 11:37 | Proxmox still logging old `f9bb3c9e` in one process window (overlap) |
| 2026-10-17 ~12:21 | Operator: sessions won't restart; dual oos labels |
| 2026-10-17 ~12:24 | SQL remap oos `5f5a87e8` → `59986e68` (793 rows); settings + displayName; hub `--no-runner` |
| 2026-10-17 ~12:26 | Cove inspect: bound to proxmox ghost → SQL remap proxmox 362 rows; hub `--no-runner` |
| 2026-10-17 ~12:27 | Cove resume success; live CLI on proxmox |

Recovery audit trails (do not delete casually):

```text
/var/lib/hapi/recovery/session-machine-remap-20261017T122423Z.tsv          # oos 793
/var/lib/hapi/recovery/session-machine-remap-proxmox-20261017T122631Z.tsv # proxmox 362
```

---

## Root causes

### RC1 - Re-enroll rotated machine UUID; migrate returned 404 (product)

Registration hit **tag/proof conflict** (`409` on `/cli/machines`), CLI rotated to a new id, then `migrateSessionsAfterReenroll` POSTed `/cli/machines/:to/migrate-sessions` and got **404**.

Hub route returns 404 when `getMachineAuthMaterial(toMachineId)` is null (`Machine not found`) - a race / material-not-ready gap on the brand-new row, or auth-material incomplete at migrate time. Either way: **register success without session move** strands Cursor (`strictMachineId`).

Related open work: [#287](https://github.com/heavygee/hapi/issues/287) / [PR #288](https://github.com/heavygee/hapi/pull/288) (omit-tag / conflict handling), [#265](https://github.com/heavygee/hapi/issues/265) (prefer in-place rebind when tag matches).

### RC2 - UI showed two hosts for one box (estate symptom of RC1)

Retired row kept `displayName: "oos"`; new live row had only `host: "oos-linux"` (no displayName) until heal set `displayName: "oos"`. Session counts followed `metadata.machineId`, so the ghost looked like the "real" fleet.

### RC3 - Settings / HAPI_HOME skew amplified confusion (estate)

| File | Before heal |
|------|-------------|
| `~/.hapi/settings.json` | `machineId` = live `59986e68` (runner) |
| `/var/lib/hapi/settings.json` (`HAPI_HOME` for hub) | still `5f5a87e8` |
| `hub.env` `HAPI_INLINE_MACHINE_ID` | still old until patched |

### RC4 - Column vs metadata machine_id drift (known, [#264](https://github.com/heavygee/hapi/issues/264))

Many rows had `sessions.machine_id` NULL while `metadata.machineId` was set. Resume routing uses metadata; column-only tools lie. Remap set **both**.

---

## What we did (heal)

1. Confirmed live runners via API + `cursor-models` RPC (200) and systemd PID match for oos.
2. SQL remap retired → live for oos and proxmox (see runbook § Emergency remap); **`hapi-restart-hub --no-runner`** after each (do not bounce runner).
3. Aligned `/var/lib/hapi/settings.json` `machineId`, appended retired id to `previousMachineIds`, set live displayNames, patched `HAPI_INLINE_MACHINE_ID`.
4. Verified Cove resume end-to-end.

**Did not** remap Teemo (no live Teemo runner; dual id `Teemo` string vs `b5157013` UUID).

---

## Audit snapshot (2026-10-17 ~12:30 local, after heal)

### Live online machines (API + cursor-models 200)

| id8 | displayName | host | runner | sessions (meta) |
|-----|-------------|------|--------|-----------------|
| `59986e68` | oos | oos-linux | running | **800** |
| `d1ca1b41` | proxmox | proxmox | running | **362** |

### Session binding (metadata.machineId)

| Binding | n | Notes |
|---------|---|--------|
| `59986e68` / oos-linux | 800 | healed |
| `d1ca1b41` / proxmox | 362 | healed |
| `Teemo` / Teemo | 31 | **orphan** - runner shutting-down; id is literal `Teemo` |
| NULL meta | 14 | mostly Aug soup/dogfood debris + odd hosts |
| `933d0035` / oos-llm-lab | 6 | host DNS dead; machine row claims running (stale) |
| `66f6955f` / OOS-BUILD|VR2 | 4 | host unreachable; stale running |

### Machines table debt (ghosts)

Many historical oos UUIDs (`e4a08a64`, `23145a5f`, …, `5f5a87e8`) and `f9bb3c9e` remain as **shutting-down / inactive** rows with **0 sessions** after remap - museum pieces, safe to leave or GC later.

Stale **active=1 + runner=running** on unreachable hosts (`oos-llm-lab`, `OOS-VR2`, `pixass10a-deb`): hub still believes they are online from last heartbeat - **not** in the web machines list filter used today (only oos + proxmox showed), but they poison any host-fallback routing if strictMachineId is off.

### Column hygiene

| Issue | n |
|-------|---|
| `machine_id` NULL while meta set (Teemo / llm-lab / VR2) | 41 |
| oos + proxmox after remap | col == meta (good) |

### Totals

- Sessions: **1217**
- Machines rows: **15**
- Flavors: cursor 801, claude 387, pi 23, codex 4, gemini 1

### Settings (aligned after heal)

```text
HAPI_HOME settings.machineId = 59986e68-c9cc-4c19-b0d3-1a9ca6963faf
~/.hapi settings.machineId   = 59986e68-… (same)
machineTag (oos)             = 87aadddd-…
proxmox settings.machineId   = d1ca1b41-… (previousMachineIds includes f9bb3c9e)
HAPI_INLINE_MACHINE_ID       = 59986e68-…
oos runner MainPID           = matches machines.runner_state.pid
```

---

## Remaining work (do not pretend green)

1. **Teemo (31 sessions)** - need a live Windows runner, then decide remap `Teemo` → `b5157013` (or whatever id is live) + column backfill. Do not SQL-blind without a working `cursor-models` on the target.
2. **Stale running ghosts** - mark `oos-llm-lab` / `OOS-VR2` / `pixass10a-deb` offline or delete if hosts are gone; remap or archive their few sessions.
3. **NULL meta (14)** - mostly historical junk; archive or bind intentionally.
4. **Product:** land [#288](https://github.com/heavygee/hapi/pull/288) (loud conflict, send tag/proof); fix migrate **404** so rotate never comes up without moving sessions; prefer tag-matched **in-place** rebind ([#265](https://github.com/heavygee/hapi/issues/265)); always write column + metadata ([#264](https://github.com/heavygee/hapi/issues/264)).
5. **Doctor / Meta** - registration probe that fails if `POST /cli/machines` is 409/5xx or migrate fails (called out in #287).

---

## Lessons

1. **Same bug twice is a process failure.** Aug 10 postmortem already wrote the SQL remap + `--no-runner` runbook. Oct 16 re-created the orphans because **migrate still 404s** and **tag conflict still rotates**.
2. **Count sessions by `metadata.machineId` joined to `runner_state`, not by displayName vibes.** Dual labels are a smell, not two computers.
3. **`cursor-models` 200 on live id + 500/ missing RPC on retired id** is the cheapest mechanical split between "ghost" and "live."
4. **Fleet waves are multi-host.** oos, proxmox, and Teemo all hit migrate 404 within ~15 minutes - audit every host after one FATAL re-enroll line.
5. **Hub `HAPI_HOME` settings ≠ `~/.hapi`.** Align both after remap or the next tool lies to you.

---

## Kill-criteria (estate healthy for resume)

- [x] API online machines ⊆ runners with `cursor-models` 200
- [x] Zero sessions with `metadata.machineId` on oos/proxmox **retired** ids
- [x] `/var/lib/hapi` and `~/.hapi` `machineId` match live oos runner
- [x] Canary Cursor resume on proxmox (Cove) succeeds
- [ ] Teemo sessions resumable on a live Teemo runner
- [ ] No stale `runner=running` on unreachable hosts (or sessions remapped/archived)
- [ ] Product migrate-after-reenroll does not 404 (PR #288 + follow-up)

---

## Appendix: mechanical audit queries

```bash
# Binding vs runner health
sqlite3 /var/lib/hapi/hapi.db "
SELECT substr(json_extract(s.metadata,'$.machineId'),1,8) mid8,
  COUNT(*) n,
  json_extract(m.runner_state,'$.status') runner,
  json_extract(m.metadata,'$.host') host,
  json_extract(m.metadata,'$.displayName') displayName
FROM sessions s
LEFT JOIN machines m ON m.id = json_extract(s.metadata,'$.machineId')
GROUP BY 1 ORDER BY n DESC;"

# Live RPC (needs web JWT via POST /api/auth {accessToken})
# GET /api/machines → for each id GET /api/machines/:id/cursor-models
```

Snapshot CSVs from the 2026-10-17 audit pass were generated under `/tmp/hapi-machine-audit-*` (ephemeral). Durable remap id lists live in `/var/lib/hapi/recovery/`.
