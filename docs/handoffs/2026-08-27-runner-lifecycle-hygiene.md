# Handoff: runner lifecycle + archive hygiene (upstream issue + fix)

**Parent orchestrator:** [tooling/meta bot](/sessions/05d9f0f2-9273-4137-933c-07459a1146a2)  
**Operator request (2026-08-27):** spawn high-effort peer to analyze systemic session/runner state drift, file upstream issue, dogfood fix, open PR. **No mass-kill** of live runner children.

## Context (verified tonight)

### Immediate outage (fixed on parent turn — do not re-litigate)

1. **No machines available / spawn broken:** Fortress #1473 left `machines.tag` + `runner_proof_hash` in Gavin hub DB while CLI `run.ts` stopped sending tag/proof after fortress strip. Runner HTTP register → 500 `MachineTagConflictError`. Cleared tag/hash on `5f5a87e8-…` (oos-linux only).
2. **Socket never went online:** Fortress strip removed `machineRpcAuthorizedId` assignment in `hub/src/socket/handlers/cli/index.ts` but left `machineHandlers` guards → `machine access denied`. Fixed in driver tip `6ec5e0423` + patient `hapi-restart-hub`.
3. **Image upload:** `POST /api/sessions/05d9f0f2…/upload` now returns `success: true` after above.

### Systemic problem (your job)

| Signal | Count (2026-08-27 audit) |
|--------|---------------------------|
| Runner `resume-processes` entries, PIDs alive | 11 |
| Session-id mismatch in registry (rotation) | 5/11 |
| API `active=true` sessions | 27 |
| DB `active=0` + `lifecycleState=running` | 235 |
| Total sessions in DB | 663 |

**Not soup-only.** Orphan runner children + stale lifecycle are core HAPI remote-runner problems. Archive hardening (#916/#1203) surfaces honest 409 when hub can't stop a live child. **Gate A cleans git/manifest, not runner PIDs.**

**Peer #1412** was a zombie (archived after killing orphan PID 451197) — example, not the fix.

### Related docs / branches

- `docs/operator/1473-fortress-removal-brief.md` — fortress soup hygiene (parent lane)
- `docs/plans/2026-08-17-a2a-nametag-only-thesis.md` — nametag-only canon
- Optional soup layer `feat/a2a-nametag-attribution` (#1618, tip `70b917447`) — restores `peer-messages` without fortress; **operator has not approved manifest add**
- Worktree: `~/coding/hapi/worktrees/1473-fortress-removal` on `driver/1473-fortress-removal` (socket fix + CLI agentAvailability restore)

## Peer-owned deliverables

1. **Written analysis** — root causes, blast radius, what operators need vs what needs upstream
2. **GitHub issue on `tiann/hapi`** — reproduction, evidence table, proposed behavior (runner reap on stand-down, archive UX, Gate A checklist line)
3. **Upstream PR** from `upstream/main` worktree — minimal fix where clearly correct; tests where meaningful
4. **Dogfood** — soup-promote to `:3006` if product code; Playwright only if UI behavior changes
5. **Do not** mass-kill runner PIDs; do not merge on `tiann/hapi` from agent shell

## Do not

- Mass-kill the 11 live runner children (includes parent meta, Overseer, PR watcher)
- Re-introduce #1473 fortress (`peerCapability`, tag/proof socket gates without full stack)
- `sudo systemctl restart hapi-hub.service` — use `hapi-restart-hub`
- Edit product code on mirror — worktree only

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer 05d9f0f2` — opens with `From: /sessions/<your-id>` + verdict
2. `AGENT_NOTIFY_SUMMARY` on final turn
