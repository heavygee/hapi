# Machine re-enroll ↔ resume (oos-linux incident 2026-08-10)

Estate runbook after dogfooding **#1473** machine/session RPC auth + peer provenance. Complements [`driver-soup.md`](./driver-soup.md).

## Symptoms

- `POST /api/sessions/:id/resume` → `RPC handler not registered: <oldMachineId>:spawn-happy-session`
- Then `No machine online` (Cursor/Pi use `strictMachineId`)
- Hub DB: `/var/lib/hapi/hapi.db` (`HAPI_HOME=/var/lib/hapi`) — **not** `~/.hapi/hapi.db`
- Settings `machineId` / live runner id / session `metadata.machineId` disagree
- ACP UI: `Executable not found in $PATH: "agent"` (often a bad spawn env, not missing binary)

## Classification (2026-08-10 Meta triage)

| Finding | Bucket | Merge gate? |
|---------|--------|-------------|
| Cold re-enroll mints new machine UUID **without** migrating sessions | **(A)** product gap on #1473 — hits **every** upgrade, not estate-only | **Yes** for #1473 |
| Multiple concurrent runners / orphan worktree runners | **(B)** estate amplifier | No |
| Bare `agent` on PATH for ACP | **(B)** estate contract; optional hardening | No for provenance PRs |

### Estate vs everyone

This is **not** "only our kitchen." Anyone who upgrades hub/cli to #1473-era machine auth (tags + memory-only `runnerProof`) and cold-restarts the runner loses the in-memory proof, hits legacy re-enroll, mints a **new machine UUID**, and strands Cursor/Pi sessions on the old id (`strictMachineId` → `spawn-happy-session` / `No machine online`). Our multi-runner soup made it louder and faster; it did not invent the hole.

Session upload RPC blindness after hub restart (CLI reconnect without `sessionTag` / capability) is the same release family (#1473 session RPC auth) — long-lived CLIs look "active" but cannot register `uploadFile` until recycled.

### Upgrade path for all existing users (with tip `4f65f30f9`+)

**Do not invent a separate forced migration product.** Coordinated hub+cli upgrade + the tip's in-place proof rebind is the path:

1. **Tagged machines (post-first-enroll):** cold runner restart **keeps machineId**; hub rebinds `runnerProofHash` when tag matches. Kill-test: Cursor resume with zero SQL.
2. **Leftover rotate** (untagged legacy / true tag conflict): CLI rotate must call migrate-sessions **without** dead `fromRunnerProof` (tip). Sessions move in-band.
3. **Untagged live machines** (Teemo / proxmox still empty tag on this estate): first register that presents a new tag still **refuses first-claim bind** and forces re-enroll with a **new** id — then (2) must migrate. Operators should expect **one** UUID change on first #1473-capable runner start per host unless they pre-seed tags carefully.
4. **Hub-only upgrade ahead of CLI:** still painful — fail-closed RPC auth with old CLIs. Ship hub+cli together; recycle long-lived session processes once after upgrade (uploads/skills).

`fix/hub-runner-version-governance` (#1108) is fleet upgrade/skew — **does not** close session `machineId` orphaning.

Peer tip (2026-08-10): `4f65f30f9` on `feat/a2a-p05-peer-provenance` — in-place proof rebind + migrate-without-dead-proof. Remat + estate kill-test still required before calling the gate closed.

## Estate policy (do this first)

1. **One runner on oos-linux:** systemd `hapi-runner-oos` only. Kill stray `runner start-sync` (worktree dogfood, stale remat shells).
2. **Never** `systemctl restart hapi-hub` from agents — use `hapi-restart-hub` (patient). Runner-only restart is OK when intentional.
3. After any runner re-enroll log line `Re-enrolled machine as <uuid>`:
   - Diff `jq .machineId /var/lib/hapi/settings.json` vs hub machines API vs session rows
   - If split: remap sessions (below) **then** restart hub so in-memory cache matches DB
4. Detached recycle / ops scripts **must** export full PATH (include `~/.local/bin`) — Meta's `/tmp/hapi-recycle-meta-upload.sh` without PATH helped produce the `agent` spawn error.

## Emergency remap (operator-approved SQL)

When product migrate path cannot run (no live `fromRunnerProof` for retired id):

```bash
# Identify live runner machine (host=oos-linux, runnerState.status=running)
LIVE=$(curl -fsS -H "Authorization: Bearer $JWT" http://127.0.0.1:3006/api/machines \
  | jq -r '.machines[] | select(.metadata.host=="oos-linux" and .runnerState.status=="running") | .id' | head -1)
OLD=e4a08a64-8f78-4b14-b566-a6c187af4f6e   # example retired id

sqlite3 /var/lib/hapi/hapi.db "
UPDATE sessions
SET machine_id = '$LIVE',
    metadata = json_set(coalesce(metadata,'{}'), '$.machineId', '$LIVE')
WHERE machine_id = '$OLD'
   OR json_extract(metadata,'$.machineId') = '$OLD';
"

# Align settings if still on retired id
jq --arg id "$LIVE" '.machineId=$id' /var/lib/hapi/settings.json > /tmp/settings.json \
  && mv /tmp/settings.json /var/lib/hapi/settings.json

# Flush hub session/machine cache WITHOUT bouncing the runner
# (default hapi-restart-hub also restarts runner → another cold re-enroll UUID)
hapi-restart-hub --no-runner
# Then resume the session from web / API
```

Kill-criteria before bulk remap: operator approval; confirm `$LIVE` has `spawn-happy-session` registered (not a shutting-down ghost row).

**Gotcha (2026-08-10):** remapping then running plain `hapi-restart-hub` restarts `hapi-runner-oos` too, which can mint yet another machine id and orphan the remap again. Always `--no-runner` after SQL remap unless you intentionally want a runner bounce.

## ACP `agent` PATH

- Binary: `~/.local/bin/agent` (symlink to cursor-agent build)
- systemd `hapi-runner-oos` Environment must include that dir (already on estate; also `/usr/local/bin/agent` symlink as belt-and-suspenders)
- Product hardcodes `command: 'agent'` in `createCursorAcpBackend` — inherits `process.env`. Fix spawn **environment**, do not assume Quest/UI bug.
- Optional upstream hardening (not a #1473 gate): resolve absolute path via `HAPI_CURSOR_AGENT_PATH` or `command -v agent` at runner start.

## Product follow-up to demand on #1473

1. On successful cold re-enroll, hub (or runner in the same register transaction) must **migrate** `metadata.machineId` / `sessions.machine_id` from retired → new id without requiring the dead machine's proof.
2. Or keep machine id stable across cold restart when tag matches and only proof rotates.
3. Wire or delete `migrateSessionsAfterReenroll`; stop claiming migrate exists if cold path never calls it.
4. Mark stale machine rows offline when PID is dead (estate still shows `e4a08a64` shutting-down with dead pid).

## Related

- Upstream: [tiann/hapi#1473](https://github.com/tiann/hapi/pull/1473), [tiann/hapi#1108](https://github.com/tiann/hapi/pull/1108), [tiann/hapi#929](https://github.com/tiann/hapi/issues/929)
- Soup comments: `driver/cli/src/runner/run.ts` (cold rotate residual), `hub/src/sync/syncEngine.ts` `migrateSessionsMachineId`, `resolveOnlineMachineForSession` + Cursor `strictMachineId`
