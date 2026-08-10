# Postmortem (LIVING): OOS upload blindness / inject / cache hell — 2026-08-10 evening

**Status:** IN PROGRESS — do not treat this as closed.  
**Written:** 2026-08-10 ~19:28Z (updated as we dig out)  
**Why this file exists:** Operator ordered a living postmortem on disk because **no HAPI session can be trusted to survive** this incident. If the meta session dies, this doc is the continuity tape.

**Related:**
- Issue family: **#1473** session/machine RPC auth + peer capability inject
- Runbook: [`docs/tooling/machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md)
- Earlier same-day: [`2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md`](./2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md)
- Worktree: `~/coding/hapi/worktrees/hub-runner-version-skew` (and `fix-self-upgrade-proof-handoff` for inject early-connect patches)
- Operator complaint that kicked the evening spiral: cannot send images to **meta HAPI triage/problems** (`a833f693-…`) — an **oos-linux** agent, not proxmox

---

## One-line verdict (so far)

We stacked **five real product/estate bugs** and then **self-inflicted three more** while "healing," so every resume became a coin flip between upload-green and `RPC handler not registered: …:uploadFile` / `peer capability inject failed`, while hub cache lied about `active`.

---

## Kill-criteria (the only proof that matters)

| Claim | Proof | Counterfeit |
|-------|-------|-------------|
| Images work for a session | `POST /api/sessions/:id/upload` JSON body → `{"success":true,…}` | Resume HTTP 200; machine online; cursor-models 200; session list "active" |
| Session is actually live | `pgrep`-style match on `existing-session-id <sid>` **and** upload success | Hub `active=true` alone |
| Runner is safe to spawn | Process env has **no** `HAPI_SESSION_ID` / `HAPI_AGENT_CONTEXT` / peer-broker inheritance; `CLI_API_TOKEN` set; inject works on a **fresh inactive** resume | `systemctl is-active` while MainPID=0 |

Upload body shape (not multipart):

```json
{"filename":"probe.png","content":"<base64>","mimeType":"image/png"}
```

Auth: `cliApiToken` → `POST /api/auth` → Bearer JWT.

---

## Snapshot at doc birth (2026-08-10T19:27Z UTC)

### Machines (API)

| id | online | host |
|----|--------|------|
| `5f5a87e8-25b2-4732-ba4c-aba95f695bd7` | true | oos-linux (live) |
| `f9bb3c9e-43fd-41ca-9e4f-a0b0414b9026` | true | proxmox |
| `Teemo` | true | Teemo |
| (plus ghost/previous ids sometimes flash online after hub bounce — ignore for spawn) | | |

Retired oos id that stranded Meta earlier: `e4a08a64-8f78-4b14-b566-a6c187af4f6e`.

### Runner reality

- **systemd `hapi-runner-oos`:** `failed` (StartLimit / crash loop earlier in the evening)
- **Actual spawn path:** manual `nohup` of compiled binary  
  `/home/heavygee/.hapi/bin/hapi-0.27.2-inject-fix runner start-sync …`  
  (PID at snapshot: `2810162`, clean env)
- Drop-ins written (not reliably running via systemd yet):
  - `40-upload-heal.conf` — `HAPI_RUNNER_WEBHOOK_TIMEOUT_MS=25000`, `HAPI_CLI_EXECUTABLE=…inject-fix`
  - `41-cli-token.conf` — `EnvironmentFile=-/home/heavygee/.hapi/cli-api-token.env`
  - `42-inject-binary-runner.conf` — `ExecStart=` override to inject-fix binary

### OOS active upload scan (19:27Z)

**ok=7 / blind=8**

Upload OK (do not casually archive these):

- `a833f693-…` **meta HAPI triage/problems** ← operator's rage target; **GREEN at snapshot**
- `05d9f0f2-…` cursor - tooling/meta bot
- `6212dae5-…` Peer #1203
- `7d55ed21-…` hub runner version governance (this session's cousin)
- `99585d61-…` WiFi mesh
- `4fdfe225-…` legacy chat attachments
- `b1d1aaf6-…` Peer #1489

Still blind (`uploadFile` not registered):

- `2bd956ae-…` Peer #1412 share native deeplink
- `fd7dea18-…` dogfood harness wake #1487
- `7189ef1c-…` Peer #1472 ACP 143
- `90165da9-…` agent-harness session wake
- `7fd700b2-…` Peer #1464 notify display
- `7341f39e-…` Peer #1452 fail-closed file links
- `55fa9dd1-…` Operator mic Newman.rip
- `b4b57901-…` Peer #1448 unknown CLI subcommand

Earlier in the evening peaks were ~**6–7 OK / ~24 blind**, then ~14, then ~10, then 8 — healing progress was real until we kept re-breaking inject / cache.

---

## Stacked root causes (product / estate — real)

### R1 — #1473 session RPC auth / tagless reconnect

Long-lived CLIs reconnect without `sessionTag` / peer capability → hub refuses session RPCs including **`uploadFile`**. Session still looks `active`.  
**False friend:** any machine-level RPC 200.

### R2 — Peer-cap inject race (early connect → `auth_failed` / burn retries)

Child often connects to inject socket **before** runner `deliverTo` arms payload. Old server replied `auth_failed` immediately; child exhausted retries → `Cannot resume: runner peer capability inject failed` even when redeem HTTP 200.

**Partial fix (worktree, compiled into estate binary):**  
`fix-self-upgrade-proof-handoff` → `cli/src/api/peerCapabilityInject.ts` holds socket until armed (`not_armed` only after timeout); `deliverTo` wait ~20s; webhook default **25s**.

Binary on disk: `~/.hapi/bin/hapi-0.27.2-inject-fix` (contains `not_armed` string).

### R3 — Webhook 15s vs inject ~16s

Runner SIGTERMs child before inject finishes. Estate drop-in / product default bump to 25s.

### R4 — Hub `active=true` short-circuit on resume

`syncEngine.resumeSession`: if `session.active` → **immediate success** without spawn / inject / uploadFile check.

Failed resume often leaves **`active=true` + dead/missing CLI** (zombie). Next resume is a no-op lie.

### R5 — Orphan / split `metadata.machineId`

Meta had pointed at retired `e4a08a64…` while live runner was `5f5a87e8…` → `No machine online` / failed resume until SQL remap + `hapi-restart-hub --no-runner`.

### R6 — Soup bun-dev ignores `HAPI_CLI_EXECUTABLE` for spawns

`getHappyCliCommand()` only uses `resolveHappyCliExecutable()` in **compiled** mode. Soup `bun run … runner` always spawns `bun --cwd … index.ts …`.  
Setting `HAPI_CLI_EXECUTABLE` on a soup runner **does nothing for children**.

**Implication:** oos soup must either (a) run the **compiled** inject-fix binary as the runner itself, or (b) patch soup `spawnHappyCLI` to honor the override in bun-dev (not done in driver yet).

### R7 — Single-flight inject server state

`startPeerCapabilityInjectServer` keeps **one** `expectedChildPid` / `pendingPayload`. Concurrent resumes on the same runner **clobber** each other → inject failures under parallel heal / UI reopen storms.

### R8 — Hub cache vs SQLite `active` desync

Observed repeatedly:

- `sqlite3 … SELECT active` → `0`
- `GET /api/sessions/:id` → `active: true`

Archive HTTP 200 can leave cache `active=true` with `lifecycleState=archived` (split-brain). Only reliable flush seen tonight: **SQL force + `hapi-restart-hub --no-runner`**.

`POST /archive` is **not** a trustworthy "make inactive" for zombies.

---

## Self-inflicted wounds (we did this; own it)

### S1 — Manual runner inherited **agent session env**

First `nohup` of inject-fix runner was started from this Cursor agent shell. Runner environ included:

- `HAPI_AGENT_CONTEXT=1`
- `HAPI_SESSION_ID=7d55ed21-…` (governance session!)
- `HAPI_PEER_DELIVER_BROKER=…` / broker server PID from parent

**Effect:** inject failed almost always until runner restarted with `env -i` clean env.  
**Canary after clean restart:** resume ~0.5s + upload success.  
**Same binary, polluted env:** 16s `inject failed`.

**Rule carved in blood:** never start estate runners from an agent tool shell without `env -i` (or systemd).

### S2 — Interrupted heal script kept running and mass-resumed

A long `python3` heal loop survived the transport cancel and kept `POST /resume` across many SIDs, thrashing the single inject slot and creating more zombies.

**Rule:** heal scripts must be PID-file + flock; kill by script path on interrupt; never leave anonymous heredoc heals.

### S3 — `pkill -f 'runner start-sync'` matched the agent shell

Shell cmdline contained the pattern → shell suicided mid-procedure. Same class: python "kill by sid in cmdline" killed the wrapper bash that mentioned the sid.

**Rule:** kill by `/proc/pid/cmdline` exact argv0 match / PID allowlist; never `pkill -f` a string that appears in the operator script.

### S4 — Healing archived already-green sessions

Scan races + "heal all blinds" archived Meta's freshly fixed peers (e.g. `2bd956ae` right after upload green). Archive/resume then failed inject under load → net regression.

**Rule:** upload-green SIDs are sacred; heal list must re-probe upload immediately before archive.

### S5 — SQL `active=0` on blinds accidentally included / left Meta inactive once

After a force-inactive pass, `meta_db` showed `active=0` until restore + second hub reload. Operator-visible risk: meta looks dead in DB while CLI still up.

**Rule:** keep an explicit allowlist of upload-OK SIDs; never bulk `UPDATE … active=0` without `NOT IN (ok…)`.

### S6 — systemd StartLimit + blocked `reset-failed`

Agent recycled MainPID → crash loop → StartLimitBurst exhausted → unit `failed`. Wrapper blocks `systemctl reset-failed` without TTY override. Fell back to manual nohup runner (then S1).

### S7 — Assumed `HAPI_CLI_EXECUTABLE` alone would fix soup

Wasted a cycle writing drop-ins that cannot fix bun-dev spawn. Had to run compiled binary as runner.

---

## Timeline (evening UTC, approximate)

| Time (UTC) | Event |
|------------|-------|
| ~18:54 | Operator: still cannot send images to **all** agents; Meta is OOS |
| ~18:57 | Drop-ins for webhook 25s + `HAPI_CLI_EXECUTABLE`; recycle oos runner MainPID |
| ~18:57–18:59 | systemd crash loop; machine briefly offline; StartLimit → `failed` |
| ~18:59 | Soup runner nohup (later found **polluted** with agent env) |
| ~18:59 | Meta resume 200 on soup CLI; upload 400 (wrong multipart API) |
| ~19:00 | Switch to inject-fix **binary** as runner; Meta resume + **upload success** |
| ~19:02 | Fleet scan ~7 OK / 24 blind |
| ~19:02–19:15 | Bulk heal interrupted by transport cancel; zombie heal kept resuming |
| ~19:16 | Heal stuck on `active` short-circuit; archive+resume → inject failed under concurrency |
| ~19:20 | Discovered polluted runner env; clean `env -i` restart |
| ~19:22 | Canary `2bd956ae` upload green on clean runner |
| ~19:23 | Heal re-broke inject (archive thrash / concurrency / short-circuit) |
| ~19:24 | Proved hub cache `active=true` while SQLite `active=0` |
| ~19:25 | `hapi-restart-hub --no-runner` cache flush; Meta restored upload-green |
| ~19:26–19:27 | Blinds still `active=true` in cache after SQL clear (reconnect zombies / incomplete flush); inject fails when resume races |
| ~19:27 | Snapshot: **7 OK / 8 blind**; Meta green; systemd runner still failed; manual clean runner up |
| ~19:28 | This living postmortem started |

---

## What actually works (repeatable recipe)

When this worked tonight:

1. Runner = **compiled** `hapi-0.27.2-inject-fix` via `env -i` (or systemd — once StartLimit cleared).
2. Target session **truly inactive** in hub cache (not just SQLite).
3. **No concurrent resumes** on that machine.
4. `POST /resume` → wait for `existing-session-id` process on inject-fix binary.
5. `POST /upload` JSON → `success:true`.

When it fails:

- Resume 200 in **&lt;50ms** with no new CLI → R4 short-circuit zombie.
- Resume 500 at **~16s** with inject failed → R2/R7/S1 (race, concurrency, or polluted env).
- Upload 500 `RPC handler not registered: …:uploadFile` with `active=true` → R1 tagless / zombie.

---

## Open work (do not lose)

1. **Finish OOS blinds (8 at snapshot)** without archiving greens; serialize; verify inactive in **API** before resume; one inject at a time.
2. **Restore systemd `hapi-runner-oos`** to inject-fix ExecStart with clean Environment; clear StartLimit (operator TTY `reset-failed` if needed); stop relying on nohup.
3. **Ship into soup/driver:** inject early-connect + webhook 25s + redeem settings fallback + (ideally) `HAPI_CLI_EXECUTABLE` honored in bun-dev **or** document that soup hosts must run compiled runner for #1473.
4. **Product fixes worth merging:**
   - Resume must not short-circuit on `active` without verifying session RPC handlers (or presence of live CLI / capability).
   - Failed resume must not leave `active=true`.
   - Archive must clear cache `active` even on split-brain archived+active.
   - Inject server must queue per-child (not single global arm).
5. **Proxmox** was largely healed earlier with inject-fix + token; re-verify after tonight's chaos if any drift.
6. **Update runbook** with: clean-env runner, upload kill-criteria, no `pkill -f`, no parallel resume, cache desync SQL+`--no-runner`.

---

## Friction mode (steelman)

**Steelman "just leave the 8 blind and ship soup later":** Meta works; operator's named pain is gone; further resume thrash risks re-zombifying greens and another StartLimit event.

**Kill that idea if:** operator still cannot attach images in the web UI to Meta (our API probe ≠ UI path), or blinds include sessions they actively use tonight.

**Cheapest falsification:** from phone/web, attach a real image to Meta `a833f693` once. If UI fails while API upload succeeds, we have a different bug (composer/attachments), not RPC.

**Steelman "SQL active=0 + hub restart is fine forever":** it is a meat cleaver. It desyncs lifecycle, confuses UI archive state, and we already set Meta inactive by accident once.

**Better:** fix resume short-circuit + archive cache (product), then estate heal becomes boring.

---

## Append-only log (keep adding below)

### 2026-08-10T19:28Z — postmortem file created

Continuity dump of evening disaster. Meta upload green. 7/8 OOS split. Manual clean inject-fix runner PID ~2810162. systemd runner failed. Do not trust sessions; trust this file + `/tmp/oos-*.json` artifacts:

- `/tmp/oos-upload-scan.json`
- `/tmp/oos-force-inactive.json`
- `/tmp/oos-heal-plan.json`
- `/tmp/oos-heal-results.json`
- `/tmp/oos-runner-inject.log`
- `/tmp/oos-postmortem-snapshot.txt`

### 2026-08-10T19:58Z — operator: why patch / upgrade system / what now

New session/resume 500s still firing (`472632df…` resume/reopen 500 @16s, inject timeout). systemd runner still `failed`; manual clean inject-fix PID 2810162; Meta upload still green.


### 2026-08-10T20:05Z — soup promote in flight; remat hold

- Thin tip `fix/peer-cap-inject-early-connect` @ `4ff262ba6` pushed (early-connect + webhook 25s + redeem fallback). Unit tests green (incl. early-connect case).
- Manifest layer added (`config/driver-manifest.yaml` + `~/.config/hapi/...`).
- Remat merge conflict on `run.ts` (versionHandoff import) **resolved** on `driver/integration-wip` as `e52658f80`.
- Live `driver/integration` still at `624327f11` — remat escalation HOLD active, owner session `05d9f0f2`. Pinged to finish rebuild.
- Until promote completes: kitchen still on manual clean `hapi-0.27.2-inject-fix` runner; systemd `hapi-runner-oos` failed.


### 2026-08-10T20:14Z — Meta remat succeeded; soup live

- Live soup tip **`ab2eab462`** with `not_armed` early-connect + webhook 25s in driver CLI.
- Hold cleared; Meta ran patient `hapi-restart-hub` (hub+runner).
- systemd runner briefly crash-looped after bounce; kitchen brought up on clean `env -i` soup bun runner; Meta upload still green; machineId `5f5a87e8…` stable.
- Drop-in `40-upload-heal.conf` slimmed (webhook 25s only; removed obsolete `HAPI_CLI_EXECUTABLE`).
- Remaining: durable systemd runner health; heal leftover upload-blind sessions; Teemo/proxmox not bounced.

### (next entry goes here)
