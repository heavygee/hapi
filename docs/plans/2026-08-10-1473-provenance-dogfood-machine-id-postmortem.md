# Postmortem: #1473 provenance dogfood → machine-id cascade + drastic restarts (2026-08-10)

**Status:** closed (mitigated on estate; product gate partially closed via tip)  
**Severity:** P1 estate / P0.5 upstream upgrade hazard (would hit any tagged-machine cold restart after #1473-era auth)  
**Authors:** Meta remat / soup stabilize (`05d9f0f2`), Peer #1203 (`6212dae5`)  
**Related:** [tiann/hapi#1473](https://github.com/tiann/hapi/pull/1473), [tiann/hapi#1203](https://github.com/tiann/hapi/issues/1203), [tiann/hapi#1108](https://github.com/tiann/hapi/pull/1108), runbook [`machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md)

Blameless. Systems and process gaps only - not "who broke the kitchen."

---

## Summary

Dogfooding **A2A P0.5 peer delivery provenance** (#1203 / upstream PR #1473) on the oos-linux soup stack forced a morning of **SQL session remaps, hub/runner restarts, CLI recycles, and a cold-runner kill-test**. The operator-visible symptoms looked like "Quest cannot upload" and "sessions will not resume after restart."

**Root cause class:** #1473 machine/session RPC auth made `runnerProof` memory-only and gated session RPCs on `sessionTag` / peer capability. Cold runner restart **minted new machine UUIDs without migrating sessions**; long-lived CLIs stayed "active" for chat but could not register `uploadFile`. Provenance work was the **dogfood trigger**, not the UUID-minting mechanism.

**Outcome:** tip `4f65f30f9` (in-place proof rebind) + soup union `4ff5fcefb` rematted; kill-test **PASS** (machineId stayed `5f5a87e8…`); chip UX `905c7e5f8` rematted to live soup `28bfaf564`. Estate runbook + this postmortem capture the blast radius so the next upgrade does not rediscover it with SQL.

---

## Impact

| Surface | What broke | Who felt it |
|---------|------------|-------------|
| Session resume (Cursor/Pi) | `RPC handler not registered: <oldId>:spawn-happy-session` → `No machine online` (`strictMachineId`) | Operator + Meta + peers on oos |
| File upload / skills / slash | `RPC handler not registered: <sessionId>:uploadFile` while chat still worked | Quest path + Peer #1203 + recycled Meta |
| Machine identity | UUID chain `e4a08a64` → `23145a5f` → … → `5f5a87e8` without session migrate | All oos sessions bound to retired ids |
| Ops toil | Patient hub+runner restarts, SQL remaps, orphan CLI archive/reopen, remat+kill-test | Meta session half a day |
| Peer #1203 UX | Sticky-active orphan CLI (no `--existing-session-id`); uploads failed until archive+reopen | Provenance peer dogfood |

**Not impacted as a product class:** Quest-specific media pipeline. That was a red herring - same hub 500 for any client hitting upload RPC on a blind CLI.

**Duration (approx, UTC 2026-08-10):** first new machine mint ~10:26 → kill-test PASS 12:22 → chip remat live ~12:25. Residual: Teemo/proxmox still untagged (one expected UUID bump on first tagged #1473 register).

---

## Timeline (UTC, 2026-08-10)

Facts only. Evidence: hub DB machine `created_at`, `/var/lib/hapi/settings.json` `previousMachineIds`, Meta session work, `/tmp/hapi-killtest-when-idle.log`, remat logs.

| Time | Event |
|------|--------|
| (prior) | Soup dogfood of #1473-family session/machine RPC auth + Peer #1203 provenance layer |
| ~10:26 | Machine `23145a5f…` created (cold re-enroll mint) |
| ~11:12–11:13 | Further mints `7ebd42bb…`, `e225e75f…`, `38c99e71…` under same machine tag |
| morning | Operator/Meta see Quest upload 500s; Meta classifies as #1473 session RPC (not Quest) |
| morning | SQL remap sessions from retired oos machines onto live runner; settings realigned |
| morning | **Gotcha:** plain `hapi-restart-hub` also restarts runner → another UUID (ouroboros). Runbook gains `--no-runner` after remap |
| ~11:47 | Peer tip `4f65f30f9` - hub tag-matched in-place `runnerProof` rebind (stable machineId) |
| ~11:48 | Live machine `5f5a87e8…` created / settled as settings `machineId` |
| ~11:51–12:02 | Tip-forward remat of rebind; soup test fail → union fix `4ff5fcefb` (refresh metadata after rebind); promote live tip `ed73592a3` |
| ~12:18 | Kill-test armed (`/tmp/hapi-killtest-when-idle.sh`); waits for peer idle |
| ~12:19 | Meta tries recycle Peer #1203 by `pgrep existing-session-id` - **no match**; upload still fails |
| ~12:21 | Discover orphan CLI `hostPid` alive **without** `--existing-session-id`; archive clears sticky cache |
| ~12:22 | Kill-test fires: hub+runner restart; `KILL_TEST_MACHINE_ID=PASS`; governance upload PASS |
| ~12:23 | Peer reopen succeeds; upload probe PASS |
| ~12:24–12:25 | Tip-forward remat chip UX `905c7e5f8` → live `28bfaf564` |
| ~12:30 | Peer acks kill-test + remat; hard-reload dogfood |

Machine id chain retained in settings:

```text
previousMachineIds: 38c99e71…, e4a08a64…
machineId (live):   5f5a87e8-25b2-4732-ba4c-aba95f695bd7
machineTag:         87aadddd-c423-4f4f-925f-fcf3e2567903
```

---

## Root causes

### RC1 - Cold re-enroll minted a new machine UUID without migrating sessions (product)

#1473-era machine auth treats `runnerProof` as memory-only. Cold runner restart loses proof → legacy re-enroll path → **new** `machineId`. Sessions keep `metadata.machineId` / `sessions.machine_id` on the retired row. Cursor/Pi use `strictMachineId` → resume RPC targets a dead machine → `spawn-happy-session` missing / `No machine online`.

`migrateSessionsMachineId` / CLI `migrateSessionsAfterReenroll` existed in spirit but the **cold path did not call a working migrate** (dead `fromRunnerProof` / wrong body). Claiming migrate without wiring it is a product footgun.

**Fix shipped on tip:** `4f65f30f9` - when machine **tag** matches, rebind `runnerProofHash` **in place** (stable id). Kill-test on estate: PASS.

### RC2 - Session RPC auth left long-lived CLIs half-alive (product)

Same release family: CLI must present `sessionTag` or peer capability to register session RPCs (`uploadFile`, skills, …). Chat/`session-alive` can succeed while upload RPC is unregistered. Hub restart or long-lived pre-capability CLIs look fine in the UI until someone attaches a file.

### RC3 - Hub session cache `active=true` with dead or wrong CLI (estate + product edge)

Peer #1203: DB `active=0`, API cache `active=true`, `hostPid` pointed at a 17h process **without** `--existing-session-id`. Resume returned success in 0ms (no-op). Recycle scripts that only `pgrep existing-session-id` silently no-op.

### RC4 - Estate amplifiers (ops, not merge gate)

- Multiple concurrent runners / stray worktree runners amplified mint frequency
- Plain `hapi-restart-hub` after SQL remap restarts runner → another mint (ouroboros)
- PATH-less detached recycle scripts → `Executable not found in $PATH: "agent"` noise
- Sticky WORKING health delayed patient kill-test drain

---

## Contributing factors

1. **Dogfood intensity:** provenance PR remats + hub/runner restarts exercised the cold path more than a quiet single-host upgrade.
2. **Symptom framing:** "Quest upload broken" steered investigation toward client/media before hub RPC registration.
3. **#1108 confusion:** fleet runner version governance does **not** fix machine-id orphaning; easy to mis-route follow-ups.
4. **Incomplete kill-criteria for "CLI recycled":** success JSON from `/resume` without verifying process cmdline + upload probe.
5. **Untagged hosts** (Teemo/proxmox): still one forced UUID bump on first tagged register - known residual.

---

## What went well

- Meta triage separated **(A) upstream upgrade hazard** vs **(B) estate amplifier** early enough to demand tip fix instead of "estate-only SQL forever."
- Peer #1203 shipped cold proof rebind (`4f65f30f9`) and chip UX (`785c4feb5` / `905c7e5f8`) the same day.
- Kill-test was explicit and falsifiable: BEFORE/AFTER machineId + resume upload.
- Runbook landed during the incident (`d57268069` → `8babe22be`) so the next agent has a map.
- Patient `hapi-restart-hub` + self-exempt WORKING avoided yanking Meta mid-turn during kill-test.
- Archive endpoint correctly cleared sticky-active when CLI RPC was gone (#916 family behavior).

---

## What went poorly

- Multiple UUID mints before the tip rebind landed - SQL remaps were necessary and costly.
- Remap then **non-`--no-runner` hub restart** risked (and in narrative did) re-orphan work - ouroboros discovered the hard way.
- Orphan CLI without session id burned a full recycle cycle and delayed peer upload restore.
- Kill-test `ping-peer` from a non-descendant shell failed (`caller is not a descendant`) - false alarm until Meta CLI tree was used.
- Fat tip-forward skips on unrelated layers remain noisy during remat (import-picker etc.) - unrelated but slowed confidence.

---

## Where we got lucky

- Settings retained `previousMachineIds` and tag `87aadddd…` so remaps and rebind had a coherent identity story.
- Live tagged machine eventually stable at `5f5a87e8…` before kill-test.
- Peer was willing to idle for remat/kill-test instead of fighting the drain.
- Soup remat tip-forward could absorb the layer without full-recipe nuclear option.

---

## Corrective actions

| # | Action | Addresses | Owner | Priority | Status |
|---|--------|-----------|-------|----------|--------|
| 1 | Ship in-place proof rebind when tag matches (`4f65f30f9`) + soup metadata refresh (`4ff5fcefb`) | RC1 | Peer #1203 / Meta remat | P0 | **Done** (kill-test PASS; soup `28bfaf564` includes tip) |
| 2 | Unverified peer chip UX (`905c7e5f8`) on :3006 | Provenance dogfood completeness | Peer #1203 / Meta | P1 | **Done** (remat + peer ack) |
| 3 | Estate runbook: remap, `--no-runner`, PATH, classification A/B | RC4, ops memory | Meta | P0 | **Done** (`machine-reenroll-resume-runbook.md`) |
| 4 | This postmortem + AGENTS index pointer | Learning | Meta | P1 | **Done** (this doc) |
| 5 | Upstream #1473 merge gate: cold-rebind + kill-criteria in PR body / review notes | RC1 | Peer #1203 (lane A prepare) | P0 | Open until #1473 merges |
| 6 | Recycle playbook: require `--existing-session-id` in cmdline + upload probe; archive if sticky cache | RC2, RC3 | Meta / tooling | P1 | Open - document in runbook § recycle |
| 7 | Pre-seed or accept one-shot UUID bump for untagged Teemo/proxmox on first tagged register | Residual | Operator / Meta | P2 | Open |
| 8 | Optional: absolute `agent` path / `HAPI_CURSOR_AGENT_PATH` | PATH noise | Upstream optional | P3 | Not a #1473 gate |
| 9 | Do **not** treat #1108 as machine-id orphan fix | Mis-routing | Meta daily | P2 | Policy note in runbook (done) |

---

## Detection / prevention (class of failure)

**Detection gaps that hurt:**

- No alert when `settings.machineId` ≠ live runner machine with `spawn-happy-session`
- No alert when session `active` in cache but no CLI with matching `--existing-session-id`
- Upload 500s looked like client bugs

**Cheap falsification tests (keep these):**

```bash
# After any hub+runner restart on a tagged host:
BEFORE=$(jq -r .machineId /var/lib/hapi/settings.json)
# ... restart ...
AFTER=$(jq -r .machineId /var/lib/hapi/settings.json)
test "$BEFORE" = "$AFTER"   # kill-criteria for tip rebind

# After "resume" / recycle:
pgrep -af "existing-session-id ${SID}"   # must match
# then POST /api/sessions/$SID/upload probe must succeed
```

**Friction (steelman):** Was the drastic restarting "because of provenance"? Only in the sense that provenance dogfood **turned the crank** on cold restart + remat. A quiet #1473 hub+cli upgrade on a single tagged runner would have hit RC1 once; our kitchen hit it repeatedly. Do not merge #1473 without the rebind tip and an explicit upgrade note for operators: recycle long-lived CLIs once; expect untagged hosts to rotate once.

---

## References

- Runbook: [`docs/tooling/machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md)
- Soup: `config/driver-manifest.yaml` layer `feat/a2a-p05-peer-provenance`
- Tips: `4f65f30f9` (rebind), `4ff5fcefb` (soup metadata), `905c7e5f8` (chip), live `28bfaf564`
- Kill-test log: `/tmp/hapi-killtest-when-idle.log` (estate, ephemeral)
- Meta session: `/sessions/05d9f0f2-9273-4137-933c-07459a1146a2`
- Peer session: `/sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4`
